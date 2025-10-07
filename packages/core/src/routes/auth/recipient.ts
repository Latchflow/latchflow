import { z } from "zod";
import type { HttpServer } from "../../http/http-server.js";
import { getDb } from "../../db/db.js";
import { genOtp, randomToken, sha256Hex } from "../../auth/tokens.js";
import { clearCookie, parseCookies, setCookie } from "../../auth/cookies.js";
import { RECIPIENT_SESSION_COOKIE, type AppConfig } from "../../config/env-config.js";
import { createAuthLogger } from "../../observability/logger.js";

export function registerRecipientAuthRoutes(server: HttpServer, config: AppConfig) {
  const db = getDb();
  const MAX_ATTEMPTS = 5;
  // Simple in-memory rate limiter (per IP+recipient+bundle+route)
  const RATE_WINDOW_MS = 60_000;
  const RATE_MAX = 10;
  const rateBuckets = new Map<string, number[]>();

  function checkRateLimit(key: string): boolean {
    const now = Date.now();
    const windowStart = now - RATE_WINDOW_MS;
    const arr = rateBuckets.get(key) ?? [];
    const recent = arr.filter((t) => t >= windowStart);
    if (recent.length >= RATE_MAX) return false;
    recent.push(now);
    rateBuckets.set(key, recent);
    return true;
  }

  // POST /auth/recipient/start
  server.post("/auth/recipient/start", async (req, res) => {
    const Body = z.union([
      z.object({ recipientId: z.string().min(1) }),
      z.object({ email: z.string().email() }),
    ]);
    type StartBody = z.infer<typeof Body>;
    const parsed = Body.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ status: "error", code: "BAD_REQUEST", message: "Invalid body" });
      return;
    }
    const body: StartBody = parsed.data;
    const subject = "recipientId" in body ? body.recipientId : body.email;
    const rlKey = `start:${req.ip ?? ""}:${subject}`;
    if (!checkRateLimit(rlKey)) {
      res.status(429).json({ status: "error", code: "RATE_LIMITED", message: "Too many requests" });
      return;
    }
    const recipient = await (async () => {
      if ("recipientId" in body) {
        return db.recipient.findUnique({ where: { id: body.recipientId } });
      }
      return db.recipient.findUnique({ where: { email: body.email } });
    })();
    if (!recipient || (recipient as { isEnabled?: boolean }).isEnabled === false) {
      res.status(404).json({ status: "error", code: "NOT_FOUND", message: "Recipient not found" });
      return;
    }
    const recipientId: string = (recipient as { id: string }).id;
    const otp = genOtp(config.RECIPIENT_OTP_LENGTH);
    const codeHash = sha256Hex(otp);
    const expiresAt = new Date(Date.now() + config.RECIPIENT_OTP_TTL_MIN * 60_000);
    // Reset existing OTPs for this recipient
    await db.recipientOtp.deleteMany({ where: { recipientId } });
    await db.recipientOtp.create({ data: { recipientId, codeHash, expiresAt } });

    // Dev-only: log the OTP
    // eslint-disable-next-line no-console
    createAuthLogger().info({ recipientId, otp }, "OTP generated for recipient (dev mode)");
    res.status(204).json({});
  });

  // POST /auth/recipient/verify
  server.post("/auth/recipient/verify", async (req, res) => {
    const Left = z.union([
      z.object({ recipientId: z.string().min(1) }),
      z.object({ email: z.string().email() }),
    ]);
    const Right = z.object({ otp: z.string().min(1) });
    const Body = z.intersection(Left, Right);
    type VerifyBody = z.infer<typeof Body>;
    const parsed = Body.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ status: "error", code: "BAD_REQUEST", message: "Invalid body" });
      return;
    }
    const body: VerifyBody = parsed.data;
    const subject = "recipientId" in body ? body.recipientId : body.email;
    const rlKey = `verify:${req.ip ?? ""}:${subject}`;
    if (!checkRateLimit(rlKey)) {
      res.status(429).json({ status: "error", code: "RATE_LIMITED", message: "Too many requests" });
      return;
    }
    const recipient = await (async () => {
      if ("recipientId" in body) {
        return db.recipient.findUnique({ where: { id: body.recipientId } });
      }
      return db.recipient.findUnique({ where: { email: body.email } });
    })();
    if (!recipient || (recipient as { isEnabled?: boolean }).isEnabled === false) {
      res
        .status(401)
        .json({ status: "error", code: "INVALID_OTP", message: "Invalid or expired OTP" });
      return;
    }
    const recipientId: string = (recipient as { id: string }).id;
    const { otp } = body;
    const now = new Date();
    const record = await db.recipientOtp.findFirst({
      where: { recipientId },
      orderBy: { createdAt: "desc" },
    });
    if (!record || record.expiresAt <= now) {
      res
        .status(401)
        .json({ status: "error", code: "INVALID_OTP", message: "Invalid or expired OTP" });
      return;
    }
    if (record.attempts >= MAX_ATTEMPTS) {
      res
        .status(429)
        .json({ status: "error", code: "TOO_MANY_ATTEMPTS", message: "Too many attempts" });
      return;
    }
    const good = record.codeHash === sha256Hex(otp);
    if (!good) {
      await db.recipientOtp.update({
        where: { id: record.id },
        data: { attempts: { increment: 1 } },
      });
      res.status(401).json({ status: "error", code: "INVALID_OTP", message: "Invalid OTP" });
      return;
    }
    // Success: create session and remove OTP
    await db.recipientOtp.delete({ where: { id: record.id } });
    const jti = randomToken(32);
    const ttlSec = config.RECIPIENT_SESSION_TTL_HOURS * 3600;
    const session = await db.recipientSession.create({
      data: {
        recipientId,
        jti,
        expiresAt: new Date(Date.now() + ttlSec * 1000),
        ip: req.ip,
        userAgent: req.userAgent,
      },
    });
    setCookie(res, RECIPIENT_SESSION_COOKIE, session.jti, {
      httpOnly: true,
      sameSite: "Lax",
      secure: config.AUTH_COOKIE_SECURE,
      domain: config.AUTH_COOKIE_DOMAIN,
      path: "/",
      maxAgeSec: ttlSec,
    });
    res.status(204).json({});
  });

  // POST /auth/recipient/logout (idempotent)
  server.post("/auth/recipient/logout", async (req, res) => {
    const cookies = parseCookies(req);
    const jti = cookies[RECIPIENT_SESSION_COOKIE];
    if (jti) {
      await db.recipientSession.updateMany({ where: { jti }, data: { revokedAt: new Date() } });
    }
    clearCookie(res, RECIPIENT_SESSION_COOKIE, {
      httpOnly: true,
      sameSite: "Lax",
      secure: config.AUTH_COOKIE_SECURE,
      domain: config.AUTH_COOKIE_DOMAIN,
      path: "/",
    });
    res.status(204).json({});
  });

  // POST /portal/auth/otp/resend (optional convenience)
  server.post("/portal/auth/otp/resend", async (req, res) => {
    const Body = z.union([
      z.object({ recipientId: z.string().min(1) }),
      z.object({ email: z.string().email() }),
    ]);
    type ResendBody = z.infer<typeof Body>;
    const parsed = Body.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ status: "error", code: "BAD_REQUEST", message: "Invalid body" });
      return;
    }
    const body: ResendBody = parsed.data;
    const subject = "recipientId" in body ? body.recipientId : body.email;
    const rlKey = `resend:${req.ip ?? ""}:${subject}`;
    if (!checkRateLimit(rlKey)) {
      res.status(429).json({ status: "error", code: "RATE_LIMITED", message: "Too many requests" });
      return;
    }
    const recipient = await (async () => {
      if ("recipientId" in body) {
        return db.recipient.findUnique({ where: { id: body.recipientId } });
      }
      return db.recipient.findUnique({ where: { email: body.email } });
    })();
    if (!recipient || (recipient as { isEnabled?: boolean }).isEnabled === false) {
      // Always return 204 so callers cannot enumerate recipients. Deliberately
      // omit any DB writes or logging in this branch.
      res.status(204).json({});
      return;
    }
    const recipientId: string = (recipient as { id: string }).id;
    const otp = genOtp(config.RECIPIENT_OTP_LENGTH);
    const codeHash = sha256Hex(otp);
    const expiresAt = new Date(Date.now() + config.RECIPIENT_OTP_TTL_MIN * 60_000);
    await db.recipientOtp.deleteMany({ where: { recipientId } });
    await db.recipientOtp.create({ data: { recipientId, codeHash, expiresAt } });
    // eslint-disable-next-line no-console
    createAuthLogger().info({ recipientId, otp }, "OTP resent for recipient (dev mode)");
    res.status(204).json({});
  });
}
