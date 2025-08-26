import { z } from "zod";
import type { HttpServer } from "../../http/http-server.js";
import { getDb } from "../../db/db.js";
import { genOtp, randomToken, sha256Hex } from "../../auth/tokens.js";
import { clearCookie, parseCookies, setCookie } from "../../auth/cookies.js";
import { RECIPIENT_SESSION_COOKIE, type AppConfig } from "../../config/config.js";

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
    const rlKey = `start:${req.ip ?? ""}`;
    if (!checkRateLimit(rlKey)) {
      res.status(429).json({ status: "error", code: "RATE_LIMITED", message: "Too many requests" });
      return;
    }
    const Body = z.object({ recipientId: z.string().min(1), bundleId: z.string().min(1) });
    const parsed = Body.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ status: "error", code: "BAD_REQUEST", message: "Invalid body" });
      return;
    }
    const { recipientId, bundleId } = parsed.data;
    const assignment = await db.bundleAssignment.findFirst({ where: { recipientId, bundleId } });
    if (!assignment) {
      res.status(404).json({
        status: "error",
        code: "NOT_FOUND",
        message: "Recipient is not assigned to bundle",
      });
      return;
    }
    const otp = genOtp(config.RECIPIENT_OTP_LENGTH);
    const codeHash = sha256Hex(otp);
    const expiresAt = new Date(Date.now() + config.RECIPIENT_OTP_TTL_MIN * 60_000);
    // Reset existing OTPs for this pair
    await db.recipientOtp.deleteMany({ where: { recipientId, bundleId } });
    await db.recipientOtp.create({ data: { recipientId, bundleId, codeHash, expiresAt } });

    // Dev-only: log the OTP
    // eslint-disable-next-line no-console
    console.log(`[auth] OTP for recipient ${recipientId}/${bundleId}: ${otp}`);
    res.status(204).json({});
  });

  // POST /auth/recipient/verify
  server.post("/auth/recipient/verify", async (req, res) => {
    const rlKey = `verify:${req.ip ?? ""}`;
    if (!checkRateLimit(rlKey)) {
      res.status(429).json({ status: "error", code: "RATE_LIMITED", message: "Too many requests" });
      return;
    }
    const Body = z.object({
      recipientId: z.string().min(1),
      bundleId: z.string().min(1),
      otp: z.string().min(1),
    });
    const parsed = Body.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ status: "error", code: "BAD_REQUEST", message: "Invalid body" });
      return;
    }
    const { recipientId, bundleId, otp } = parsed.data;
    const now = new Date();
    const record = await db.recipientOtp.findFirst({
      where: { recipientId, bundleId },
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
        bundleId,
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

  // POST /auth/recipient/logout
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
}
