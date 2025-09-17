import { z } from "zod";
import type { HttpServer } from "../../http/http-server.js";
import { getDb } from "../../db/db.js";
import { Prisma } from "@latchflow/db";
import { randomToken, sha256Hex } from "../../auth/tokens.js";
import { ADMIN_SESSION_COOKIE, type AppConfig } from "../../config/config.js";
import { clearCookie, parseCookies, setCookie } from "../../auth/cookies.js";
import nodemailer from "nodemailer";
import type SMTPTransport from "nodemailer/lib/smtp-transport";
import { requireAdmin } from "../../middleware/require-admin.js";
import { bootstrapGrantAdminIfOnlyUserTx } from "../../auth/bootstrap.js";

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

    // If no users exist yet, atomically create a new user
    // (will be auto-upgraded to ADMIN on first login).
    // Use a SERIALIZABLE transaction so simultaneous calls don't create
    // more than one initial user across different emails.
    let user = null as Awaited<ReturnType<typeof db.user.findUnique>> | null;
    try {
      user = await db.$transaction(
        async (tx) => {
          // First, prefer an existing user for this email if present
          const existing = await tx.user.findUnique({ where: { email } });
          if (existing) return existing;

          // Check whether ANY user exists yet (COUNT under serializable)
          const existingCount = await tx.user.count();
          if (existingCount > 0) return null;

          // Create first user
          return tx.user.upsert({
            where: { email },
            update: {},
            create: { email },
          });
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (err) {
      // If another concurrent request won the race, fall back to lookup.
      // Do not surface details to caller to avoid user enumeration.
      user = await db.user.findUnique({ where: { email } });
    }

    if (!user) {
      console.log(`[auth] Magic link requested for non-existent user: ${email}`);
      return res.sendStatus(204); // Do not reveal whether the user exists
    }

    const token = randomToken(32);
    const tokenHash = sha256Hex(token);
    const expiresAt = new Date(Date.now() + config.ADMIN_MAGICLINK_TTL_MIN * 60_000);
    await db.magicLink.create({ data: { userId: user.id, tokenHash, expiresAt } });

    // Dev helper: optionally return login_url instead of relying on email delivery
    if (config.ALLOW_DEV_AUTH) {
      return res.status(200).json({ login_url: `/auth/admin/callback?token=${token}` });
    }
    // Attempt email delivery via SMTP when configured
    if (config.SMTP_URL) {
      try {
        const u = new URL(config.SMTP_URL);
        const transporter = nodemailer.createTransport({
          host: u.hostname,
          port: Number(u.port || 25),
          secure: false,
          ignoreTLS: true,
          auth:
            u.username || u.password
              ? { user: decodeURIComponent(u.username), pass: decodeURIComponent(u.password) }
              : undefined,
          tls: { rejectUnauthorized: false },
        } satisfies SMTPTransport.Options);
        const from = config.SMTP_FROM ?? "no-reply@latchflow.local";
        const loginPath = `/auth/admin/callback?token=${token}`;
        const html = `<p>Click to sign in:</p><p><a href="${loginPath}">${loginPath}</a></p>`;
        // eslint-disable-next-line no-console
        console.log(`[auth] Sending magic link to ${email} via SMTP ${u.hostname}:${u.port || 25}`);
        await transporter.sendMail({
          from,
          to: email,
          subject: "Latchflow admin login",
          html,
          text: loginPath,
        });
        // eslint-disable-next-line no-console
        console.log(`[auth] SMTP send completed for ${email}`);
        return res.sendStatus(204);
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn("[auth] SMTP delivery failed:", (e as Error).message);
        return res.status(500).json({
          status: "error",
          code: "EMAIL_FAILED",
          message: "Failed to send email",
        });
      }
    }

    // Dev-only: log the callback URL (partial token)
    // eslint-disable-next-line no-console
    console.log(
      `[auth] Magic link for ${email}: /auth/admin/callback?token=${token.substring(0, 4)}… (full token hidden)`,
    );

    return res.sendStatus(204);
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

    // Consume the token (atomic check+set)
    const { count } = await db.magicLink.updateMany({
      where: { tokenHash, consumedAt: null, expiresAt: { gt: now } },
      data: { consumedAt: now },
    });
    if (count === 0) {
      res.status(401).json({ status: "error", code: "INVALID_TOKEN", message: "Invalid token" });
      return;
    }

    // Check the token again to get userId
    const link = await db.magicLink.findUnique({
      where: { tokenHash },
      select: { id: true, userId: true },
    });
    if (!link) {
      res.status(401).json({ status: "error", code: "INVALID_TOKEN", message: "Invalid token" });
      return;
    }

    // Issue a session for the user (if active)
    const targetUser = await db.user.findUnique({
      where: { id: link.userId },
      select: { id: true, isActive: true },
    });
    if (!targetUser || targetUser.isActive === false) {
      res.status(403).json({ status: "error", code: "INACTIVE_USER", message: "User is inactive" });
      return;
    }

    // Auto-bootstrap: grant ADMIN/EXECUTOR only when this is the only user in the system.
    try {
      await db.$transaction(
        async (tx) => {
          await bootstrapGrantAdminIfOnlyUserTx(tx, link.userId);
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (e) {
      // Do not block login on bootstrap errors
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
    res.sendStatus(204);
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
      const role = (user as unknown as { role: string }).role;
      res.status(200).json({ user: { id: user.id, email: user.email, role }, session });
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
      const role = (user as unknown as { role: string }).role;
      res.status(200).json({ kind: "admin", user: { id: user.id, email: user.email, role } });
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
