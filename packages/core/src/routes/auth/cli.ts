import { z } from "zod";
import type { HttpServer } from "../../http/http-server.js";
import { getDb } from "../../db/db.js";
import {
  formatApiToken,
  makeDeviceCode,
  makeUserCode,
  randomTokenBase64Url,
  sha256Hex,
} from "../../auth/tokens.js";
import { type AppConfig } from "../../config/config.js";
import { requireAdmin } from "../../middleware/require-admin.js";

export function registerCliAuthRoutes(server: HttpServer, config: AppConfig) {
  const db = getDb();
  // Transient cache for delivering raw API tokens after approval (not persisted)
  const deviceTokenCache = new Map<string, string>(); // key: deviceCodeHash -> raw token with prefix
  // Simple per-IP rate limiter for start/poll
  const RATE_WINDOW_MS = 60_000;
  const RATE_MAX = 10;
  const rateBuckets = new Map<string, number[]>();
  // Per-device polling backoff tracker keyed by deviceCodeHash
  const pollNextAllowedAt = new Map<string, number>();
  function checkRate(ip: string, key: string): boolean {
    const now = Date.now();
    const windowStart = now - RATE_WINDOW_MS;
    const k = `${ip || ""}:${key}`;
    const arr = rateBuckets.get(k) ?? [];
    const recent = arr.filter((t) => t >= windowStart);
    if (recent.length >= RATE_MAX) return false;
    recent.push(now);
    rateBuckets.set(k, recent);
    return true;
  }

  // POST /auth/cli/device/start
  server.post("/auth/cli/device/start", async (req, res) => {
    if (!checkRate(req.ip ?? "", "device:start")) {
      res.status(429).json({ status: "error", code: "RATE_LIMITED", message: "Too many requests" });
      return;
    }
    const Body = z.object({ email: z.string().email(), deviceName: z.string().optional() });
    const parsed = Body.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ status: "error", code: "BAD_REQUEST", message: "Invalid body" });
      return;
    }
    const { email, deviceName } = parsed.data;
    // Ensure user exists
    const user = await db.user.upsert({
      where: { email },
      update: {},
      create: { email, roles: ["EXECUTOR"] },
    });
    const device_code = makeDeviceCode();
    const user_code = makeUserCode();
    const deviceCodeHash = sha256Hex(device_code);
    const userCodeHash = sha256Hex(user_code);
    const expiresAt = new Date(Date.now() + config.DEVICE_CODE_TTL_MIN * 60_000);
    const record = await db.deviceAuth.create({
      data: {
        userId: user.id,
        email,
        deviceName,
        deviceCodeHash,
        userCodeHash,
        intervalSec: config.DEVICE_CODE_INTERVAL_SEC,
        expiresAt,
      },
    });
    const verification_uri = config.ADMIN_UI_ORIGIN
      ? `${config.ADMIN_UI_ORIGIN}/cli/device/approve`
      : `/auth/cli/device/approve`;
    res.status(200).json({
      device_code,
      user_code,
      verification_uri,
      expires_in: Math.floor((record.expiresAt.getTime() - Date.now()) / 1000),
      interval: record.intervalSec,
    });
  });

  // POST /auth/cli/device/approve
  server.post("/auth/cli/device/approve", async (req, res) => {
    // Gate via admin cookie session, so only admins/executors can approve
    try {
      const { user } = await requireAdmin(req);
      const roles = (user as unknown as { roles: string[] }).roles;
      if (!roles?.includes("ADMIN") && !roles?.includes("EXECUTOR")) {
        res.status(403).json({ status: "error", code: "FORBIDDEN", message: "Insufficient role" });
        return;
      }
    } catch (e) {
      const err = e as Error & { status?: number };
      res
        .status(err.status ?? 401)
        .json({ status: "error", code: "UNAUTHORIZED", message: err.message });
      return;
    }
    const Body = z.object({ user_code: z.string().min(1) });
    const parsed = Body.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ status: "error", code: "BAD_REQUEST", message: "Invalid body" });
      return;
    }
    const { user_code } = parsed.data;
    const now = new Date();
    const record = await db.deviceAuth.findFirst({
      where: { userCodeHash: sha256Hex(user_code) },
      include: { user: true },
    });
    if (!record || record.expiresAt <= now) {
      res.status(410).json({ status: "error", code: "EXPIRED", message: "Code expired" });
      return;
    }
    if (record.approvedAt) {
      res
        .status(409)
        .json({ status: "error", code: "ALREADY_APPROVED", message: "Already approved" });
      return;
    }
    const scopes = config.API_TOKEN_SCOPES_DEFAULT;
    const raw = randomTokenBase64Url(32);
    const tokenHash = sha256Hex(raw);
    const name = record.deviceName || "CLI Token";
    const expiresAt =
      typeof config.API_TOKEN_TTL_DAYS === "number"
        ? new Date(Date.now() + config.API_TOKEN_TTL_DAYS * 86400_000)
        : undefined;
    const token = await db.apiToken.create({
      data: {
        userId: record.userId!,
        name,
        scopes,
        tokenHash,
        expiresAt,
      },
    });
    // Cache the formatted raw token in memory keyed by deviceCodeHash
    deviceTokenCache.set(record.deviceCodeHash, formatApiToken(config.API_TOKEN_PREFIX, raw));
    await db.deviceAuth.update({
      where: { id: record.id },
      data: { approvedAt: now, tokenId: token.id },
    });
    res.status(204).json({});
  });

  // POST /auth/cli/device/poll
  server.post("/auth/cli/device/poll", async (req, res) => {
    if (!checkRate(req.ip ?? "", "device:poll")) {
      res.status(429).json({ status: "error", code: "RATE_LIMITED", message: "Too many requests" });
      return;
    }
    const Body = z.object({ device_code: z.string().min(1) });
    const parsed = Body.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ status: "error", code: "BAD_REQUEST", message: "Invalid body" });
      return;
    }
    const { device_code } = parsed.data;
    const deviceCodeHash = sha256Hex(device_code);
    const record = await db.deviceAuth.findFirst({ where: { deviceCodeHash } });
    if (!record) {
      res
        .status(400)
        .json({ status: "error", code: "INVALID_CODE", message: "Invalid device code" });
      return;
    }
    // Enforce minimum polling interval per device record
    const nowMs = Date.now();
    const nextAllowed = pollNextAllowedAt.get(deviceCodeHash) ?? 0;
    if (nowMs < nextAllowed) {
      const retryInSec = Math.ceil((nextAllowed - nowMs) / 1000);
      res.status(429).json({
        status: "error",
        code: "SLOW_DOWN",
        interval: record.intervalSec,
        retry_in: retryInSec,
      });
      return;
    }
    pollNextAllowedAt.set(deviceCodeHash, nowMs + record.intervalSec * 1000);
    if (record.expiresAt <= new Date()) {
      res.status(410).json({ status: "error", code: "EXPIRED", message: "Code expired" });
      return;
    }
    if (!record.approvedAt || !record.tokenId) {
      res.status(202).json({ status: "pending", interval: record.intervalSec });
      return;
    }
    const apiToken = await db.apiToken.findUnique({ where: { id: record.tokenId } });
    if (!apiToken || apiToken.revokedAt) {
      res.status(410).json({ status: "error", code: "REVOKED", message: "Token revoked" });
      return;
    }
    const cached = deviceTokenCache.get(record.deviceCodeHash);
    if (!cached) {
      res
        .status(410)
        .json({ status: "error", code: "UNAVAILABLE", message: "Token unavailable; restart flow" });
      return;
    }
    const payload: Record<string, unknown> = {
      access_token: cached,
      token_type: "bearer",
      scopes: apiToken.scopes,
    };
    if (apiToken.expiresAt) payload.expires_at = apiToken.expiresAt.toISOString();
    // One-shot: delete from cache so subsequent polls don't re-leak
    deviceTokenCache.delete(record.deviceCodeHash);
    res.status(200).json(payload);
  });

  // GET /auth/cli/tokens (admin/executor session only for now)
  server.get("/auth/cli/tokens", async (req, res) => {
    try {
      const { user } = await requireAdmin(req);
      const tokens = await db.apiToken.findMany({
        where: { userId: user.id },
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          name: true,
          scopes: true,
          createdAt: true,
          lastUsedAt: true,
          expiresAt: true,
          revokedAt: true,
        },
      });
      res.status(200).json({ tokens });
    } catch (e) {
      const err = e as Error & { status?: number };
      res
        .status(err.status ?? 401)
        .json({ status: "error", code: "UNAUTHORIZED", message: err.message });
    }
  });

  // POST /auth/cli/tokens/revoke
  server.post("/auth/cli/tokens/revoke", async (req, res) => {
    try {
      const { user } = await requireAdmin(req);
      const Body = z.object({ tokenId: z.string().min(1) });
      const parsed = Body.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ status: "error", code: "BAD_REQUEST", message: "Invalid body" });
        return;
      }
      const { tokenId } = parsed.data;
      await db.apiToken.updateMany({
        where: { id: tokenId, userId: user.id },
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
