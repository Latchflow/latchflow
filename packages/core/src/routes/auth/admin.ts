import { z } from "zod";
import type { HttpServer } from "../../http/http-server.js";
import { getDb } from "../../db/db.js";
import { $Enums } from "@latchflow/db";
import { randomToken, sha256Hex } from "../../auth/tokens.js";
import { ADMIN_SESSION_COOKIE, type AppConfig } from "../../config/config.js";
import { clearCookie, parseCookies, setCookie } from "../../auth/cookies.js";
import { requireAdmin } from "../../middleware/require-admin.js";

export function registerAdminAuthRoutes(server: HttpServer, config: AppConfig) {
  const db = getDb();

  // POST /auth/admin/start
  server.post("/auth/admin/start", async (req, res) => {
    const Body = z.object({ email: z.string().email() });
    const parsed = Body.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ status: "error", code: "BAD_REQUEST", message: "Invalid body" });
      return;
    }
    const { email } = parsed.data;

    // If *no* users exist yet, create a new user with no roles (will be auto-upgraded to ADMIN on first login)
    const userCount = await db.user.count();
    const user =
      userCount > 0
        ? await db.user.findUnique({ where: { email } })
        : await db.user.upsert({
            where: { email },
            update: {},
            create: { email, roles: [] },
          });

    if (!user) {
      res.status(404).json({ status: "error", code: "NOT_FOUND", message: "User not found" });
      return;
    }

    const token = randomToken(32);
    const tokenHash = sha256Hex(token);
    const expiresAt = new Date(Date.now() + config.ADMIN_MAGICLINK_TTL_MIN * 60_000);
    await db.magicLink.create({ data: { userId: user.id, tokenHash, expiresAt } });

    // Dev helper: optionally return login_url instead of relying on email delivery
    if (config.ALLOW_DEV_AUTH) {
      res.status(200).json({ login_url: `/auth/admin/callback?token=${token}` });
      return;
    }
    // Dev-only: log the callback URL (partial token)
    // eslint-disable-next-line no-console
    console.log(
      `[auth] Magic link for ${email}: /auth/admin/callback?token=${token.substring(0, 4)}… (full token hidden)`,
    );
    res.status(204).json({});
  });

  // GET /auth/admin/callback
  server.get("/auth/admin/callback", async (req, res) => {
    const Q = z.object({ token: z.string().min(1) });
    const parsed = Q.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ status: "error", code: "BAD_REQUEST", message: "Missing token" });
      return;
    }
    const { token } = parsed.data;
    const tokenHash = sha256Hex(token);
    const now = new Date();
    const link = await db.magicLink.findUnique({ where: { tokenHash } });
    if (!link || link.consumedAt || link.expiresAt <= now) {
      res.status(401).json({ status: "error", code: "INVALID_TOKEN", message: "Invalid token" });
      return;
    }
    await db.magicLink.update({ where: { id: link.id }, data: { consumedAt: now } });

    // Auto-bootstrap: if there are no admins yet, grant ADMIN to this verified user
    try {
      const adminCount = await db.user.count({ where: { roles: { has: "ADMIN" } } });
      if (adminCount === 0) {
        const u = await db.user.findUnique({
          where: { id: link.userId },
          select: { id: true, email: true, roles: true },
        });
        if (u) {
          const roles = Array.from(
            new Set([...(u.roles ?? []), $Enums.UserRole.ADMIN]),
          ) as $Enums.UserRole[];
          await db.user.update({ where: { id: u.id }, data: { roles } });
          // eslint-disable-next-line no-console
          console.log(`[auth] Bootstrap: granted ADMIN to ${u.email}`);
        }
      }
    } catch (e) {
      // Do not block login on bootstrap errors; proceed with session creation
      // eslint-disable-next-line no-console
      console.warn("[auth] Bootstrap check failed:", (e as Error).message);
    }

    const jti = randomToken(32);
    const sessTtlSec = config.AUTH_SESSION_TTL_HOURS * 3600;
    const session = await db.session.create({
      data: {
        userId: link.userId,
        jti,
        expiresAt: new Date(now.getTime() + sessTtlSec * 1000),
        ip: req.ip,
        userAgent: req.userAgent,
      },
    });
    setCookie(res, ADMIN_SESSION_COOKIE, session.jti, {
      httpOnly: true,
      sameSite: "Lax",
      secure: config.AUTH_COOKIE_SECURE,
      domain: config.AUTH_COOKIE_DOMAIN,
      path: "/",
      maxAgeSec: sessTtlSec,
    });

    if (config.ADMIN_UI_ORIGIN) {
      res.redirect(config.ADMIN_UI_ORIGIN);
      return;
    }
    res.status(204).json({});
  });

  // POST /auth/admin/logout
  server.post("/auth/admin/logout", async (req, res) => {
    const cookies = parseCookies(req);
    const jti = cookies[ADMIN_SESSION_COOKIE];
    if (jti) {
      await db.session.updateMany({ where: { jti }, data: { revokedAt: new Date() } });
    }
    clearCookie(res, ADMIN_SESSION_COOKIE, {
      httpOnly: true,
      sameSite: "Lax",
      secure: config.AUTH_COOKIE_SECURE,
      domain: config.AUTH_COOKIE_DOMAIN,
      path: "/",
    });
    res.status(204).json({});
  });

  // GET /auth/me
  server.get("/auth/me", async (req, res) => {
    try {
      const { user, session } = await requireAdmin(req);
      const roles = (user as unknown as { roles: string[] }).roles;
      res.status(200).json({ user: { id: user.id, email: user.email, roles }, session });
    } catch (e) {
      const err = e as Error & { status?: number };
      res
        .status(err.status ?? 401)
        .json({ status: "error", code: "UNAUTHORIZED", message: err.message });
    }
  });

  // GET /whoami (admin cookie path)
  server.get("/whoami", async (req, res) => {
    try {
      const { user } = await requireAdmin(req);
      const roles = (user as unknown as { roles: string[] }).roles;
      res.status(200).json({ kind: "admin", user: { id: user.id, email: user.email, roles } });
    } catch (e) {
      const err = e as Error & { status?: number };
      res
        .status(err.status ?? 401)
        .json({ status: "error", code: "UNAUTHORIZED", message: err.message });
    }
  });

  // GET /auth/sessions (list sessions for current user)
  server.get("/auth/sessions", async (req, res) => {
    try {
      const { user } = await requireAdmin(req);
      const now = new Date();
      const items = (await db.session.findMany({
        where: { userId: user.id, OR: [{ revokedAt: null }, { revokedAt: undefined }] },
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          createdAt: true,
          expiresAt: true,
          ip: true,
          userAgent: true,
          revokedAt: true,
        },
      })) as Array<{
        id: string;
        createdAt: Date | string;
        expiresAt: Date | string;
        ip?: string | null;
        userAgent?: string | null;
        revokedAt?: Date | string | null;
      }>;
      const active = items
        .filter((s) => !s.revokedAt && new Date(s.expiresAt) > now)
        .map(({ revokedAt, ...rest }) => rest);
      res.status(200).json({ items: active });
    } catch (e) {
      const err = e as Error & { status?: number };
      res
        .status(err.status ?? 401)
        .json({ status: "error", code: "UNAUTHORIZED", message: err.message });
    }
  });

  // POST /auth/sessions/revoke
  server.post("/auth/sessions/revoke", async (req, res) => {
    try {
      const { user } = await requireAdmin(req);
      const Body = z.object({ sessionId: z.string().min(1) });
      const parsed = Body.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ status: "error", code: "BAD_REQUEST", message: "Invalid body" });
        return;
      }
      const { sessionId } = parsed.data;
      await db.session.updateMany({
        where: { id: sessionId, userId: user.id },
        data: { revokedAt: new Date() },
      });
      res.status(204).json({});
    } catch (e) {
      const err = e as Error & { status?: number };
      res
        .status(err.status ?? 401)
        .json({ status: "error", code: "UNAUTHORIZED", message: err.message });
    }
  });
}
