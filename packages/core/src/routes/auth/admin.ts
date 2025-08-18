import { z } from "zod";
import type { HttpServer } from "../../http/http-server.js";
import { getDb } from "../../db.js";
import { randomToken, sha256Hex } from "../../auth/tokens.js";
import { ADMIN_SESSION_COOKIE, type AppConfig } from "../../config.js";
import { clearCookie, setCookie } from "../../auth/cookies.js";
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
    // Upsert user with default role EXECUTOR if new
    const user = await db.user.upsert({
      where: { email },
      update: {},
      create: { email, role: "EXECUTOR" },
    });

    const token = randomToken(32);
    const tokenHash = sha256Hex(token);
    const expiresAt = new Date(Date.now() + config.ADMIN_MAGICLINK_TTL_MIN * 60_000);
    await db.magicLink.create({ data: { userId: user.id, tokenHash, expiresAt } });

    // Dev-only: log the callback URL
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
    const { token } = parsed.data as { token: string };
    const tokenHash = sha256Hex(token);
    const now = new Date();
    const link = await db.magicLink.findUnique({ where: { tokenHash } });
    if (!link || link.consumedAt || link.expiresAt <= now) {
      res.status(401).json({ status: "error", code: "INVALID_TOKEN", message: "Invalid token" });
      return;
    }
    await db.magicLink.update({ where: { id: link.id }, data: { consumedAt: now } });

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
    const cookies = ((req.headers?.["cookie"] as string) ?? "").split(";");
    const raw = cookies.find((c) => c.trim().startsWith(`${ADMIN_SESSION_COOKIE}=`));
    if (raw) {
      const jti = decodeURIComponent(raw.split("=")[1] ?? "");
      if (jti) {
        await db.session.updateMany({ where: { jti }, data: { revokedAt: new Date() } });
      }
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
      res.status(200).json({ user: { id: user.id, email: user.email, role: user.role }, session });
    } catch (e) {
      const err = e as Error & { status?: number };
      res
        .status(err.status ?? 401)
        .json({ status: "error", code: "UNAUTHORIZED", message: err.message });
    }
  });
}
