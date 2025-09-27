import { z } from "zod";
import type { HttpServer } from "../../http/http-server.js";
import { getDb } from "../../db/db.js";
import { Prisma } from "@latchflow/db";
import type { ChangeKind } from "@latchflow/db";
import { requireAdminOrApiToken } from "../../middleware/require-admin-or-api-token.js";
import { SCOPES } from "../../auth/scopes.js";
import type { RouteSignature } from "../../authz/policy.js";
import type { AppConfig } from "../../config/env-config.js";
import { appendChangeLog } from "../../history/changelog.js";
import { randomToken, sha256Hex } from "../../auth/tokens.js";
import nodemailer from "nodemailer";
import type SMTPTransport from "nodemailer/lib/smtp-transport";
import { getSystemConfigService } from "../../config/system-config-startup.js";

const ROLES = ["ADMIN", "EXECUTOR"] as const;

export function registerUserAdminRoutes(server: HttpServer, config: AppConfig) {
  const db = getDb();
  const systemConfigServicePromise = getSystemConfigService(db, config);
  const historyCfg: Pick<AppConfig, "HISTORY_SNAPSHOT_INTERVAL" | "HISTORY_MAX_CHAIN_DEPTH"> = {
    HISTORY_SNAPSHOT_INTERVAL: config.HISTORY_SNAPSHOT_INTERVAL,
    HISTORY_MAX_CHAIN_DEPTH: config.HISTORY_MAX_CHAIN_DEPTH,
  };

  const actorContextForReq = (req: unknown) => {
    const user = (req as { user?: { id?: string } }).user;
    const actorId = user?.id ?? config.SYSTEM_USER_ID ?? "system";
    return { actorType: "USER" as const, actorUserId: actorId };
  };

  const toUserDto = (u: {
    id: string;
    email: string;
    name: string | null;
    displayName: string | null;
    avatarUrl: string | null;
    role: string;
    isActive: boolean;
    createdAt: Date | string;
    updatedAt: Date | string;
  }) => ({
    id: u.id,
    email: u.email,
    name: u.name,
    displayName: u.displayName,
    avatarUrl: u.avatarUrl,
    role: u.role,
    isActive: u.isActive,
    createdAt: typeof u.createdAt === "string" ? u.createdAt : u.createdAt.toISOString(),
    updatedAt: typeof u.updatedAt === "string" ? u.updatedAt : u.updatedAt.toISOString(),
  });

  const isUniqueConstraintError = (err: unknown): err is { code: string } => {
    return (
      typeof err === "object" &&
      err !== null &&
      "code" in err &&
      (err as { code?: string }).code === "P2002"
    );
  };

  async function resolveEmailConfig(key: "SMTP_URL" | "SMTP_FROM"): Promise<string | null> {
    try {
      const service = await systemConfigServicePromise;
      const record = await service.get(key);
      if (typeof record?.value === "string" && record.value.trim().length > 0) {
        return record.value;
      }
    } catch {
      // Ignore resolution errors and fall back to environment-derived config
    }

    if (key === "SMTP_URL") {
      const fallback = config.SMTP_URL?.trim();
      return fallback && fallback.length > 0 ? fallback : null;
    }
    if (key === "SMTP_FROM") {
      const fallback = config.SMTP_FROM?.trim();
      return fallback && fallback.length > 0 ? fallback : null;
    }
    return null;
  }

  async function sendMagicLinkEmail(email: string, token: string) {
    if (config.ALLOW_DEV_AUTH) {
      return { loginUrl: `/auth/admin/callback?token=${token}` } as const;
    }
    const smtpUrlValue = await resolveEmailConfig("SMTP_URL");
    if (!smtpUrlValue) {
      return null;
    }

    const smtpFromValue = (await resolveEmailConfig("SMTP_FROM")) ?? "no-reply@latchflow.local";

    let smtpUrl: URL;
    try {
      smtpUrl = new URL(smtpUrlValue);
    } catch {
      return null;
    }
    const transporter = nodemailer.createTransport({
      host: smtpUrl.hostname,
      port: Number(smtpUrl.port || 25),
      secure: false,
      ignoreTLS: true,
      auth:
        smtpUrl.username || smtpUrl.password
          ? {
              user: decodeURIComponent(smtpUrl.username),
              pass: decodeURIComponent(smtpUrl.password),
            }
          : undefined,
      tls: { rejectUnauthorized: false },
    } satisfies SMTPTransport.Options);
    const from = smtpFromValue;
    const loginPath = `/auth/admin/callback?token=${token}`;
    await transporter.sendMail({
      from,
      to: email,
      subject: "Latchflow admin invitation",
      html: `<p>You have been invited to Latchflow.</p><p><a href="${loginPath}">Click to accept</a></p>`,
      text: loginPath,
    });
    return null;
  }

  // GET /users
  server.get(
    "/users",
    requireAdminOrApiToken({
      policySignature: "GET /users" as RouteSignature,
      scopes: [SCOPES.USERS_READ],
    })(async (req, res) => {
      const Q = z.object({
        limit: z.coerce.number().int().min(1).max(200).optional(),
        cursor: z.string().optional(),
        q: z.string().optional(),
        role: z.enum(ROLES).optional(),
        isActive: z.coerce.boolean().optional(),
        updatedSince: z.coerce.date().optional(),
      });
      const parsed = Q.safeParse(req.query ?? {});
      const query = parsed.success ? parsed.data : {};
      const where: Prisma.UserWhereInput = {};
      if (query.q) {
        where.OR = [
          { email: { contains: query.q, mode: "insensitive" } },
          { name: { contains: query.q, mode: "insensitive" } },
          { displayName: { contains: query.q, mode: "insensitive" } },
        ];
      }
      if (query.role) where.role = query.role;
      if (typeof query.isActive === "boolean") where.isActive = query.isActive;
      if (query.updatedSince)
        where.updatedAt = { gte: query.updatedSince } as Prisma.DateTimeFilter;
      const take = query.limit ?? 50;
      const rows = await db.user.findMany({
        where,
        orderBy: { id: "desc" },
        take,
        ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      });
      const items = rows.map(toUserDto);
      const nextCursor = rows.length === take ? rows[rows.length - 1]?.id : undefined;
      res.status(200).json({ items, nextCursor });
    }),
  );

  // POST /users — create active user
  server.post(
    "/users",
    requireAdminOrApiToken({
      policySignature: "POST /users" as RouteSignature,
      scopes: [SCOPES.USERS_WRITE],
    })(async (req, res) => {
      const Body = z.object({
        email: z.string().email(),
        name: z.string().trim().max(200).nullish(),
        displayName: z.string().trim().max(200).nullish(),
        role: z.enum(ROLES).optional(),
      });
      const parsed = Body.safeParse(req.body ?? {});
      if (!parsed.success) {
        res.status(400).json({ status: "error", code: "BAD_REQUEST" });
        return;
      }
      const actor = actorContextForReq(req);
      try {
        const created = await db.user.create({
          data: {
            email: parsed.data.email.toLowerCase(),
            name: parsed.data.name ?? null,
            displayName: parsed.data.displayName ?? null,
            role: parsed.data.role ?? "EXECUTOR",
            isActive: true,
          },
        });
        await appendChangeLog(db, historyCfg, "USER", created.id, actor, {
          changeKind: "UPDATE_PARENT" as ChangeKind,
        });
        res.status(201).json(toUserDto(created));
      } catch (err) {
        if (isUniqueConstraintError(err)) {
          res.status(409).json({ status: "error", code: "EMAIL_EXISTS" });
          return;
        }
        throw err;
      }
    }),
  );

  // POST /users/invite — create inactive user with magic link
  server.post(
    "/users/invite",
    requireAdminOrApiToken({
      policySignature: "POST /users/invite" as RouteSignature,
      scopes: [SCOPES.USERS_WRITE],
    })(async (req, res) => {
      const Body = z.object({
        email: z.string().email(),
        name: z.string().trim().max(200).nullish(),
        displayName: z.string().trim().max(200).nullish(),
        role: z.enum(ROLES).optional(),
      });
      const parsed = Body.safeParse(req.body ?? {});
      if (!parsed.success) {
        res.status(400).json({ status: "error", code: "BAD_REQUEST" });
        return;
      }
      const actor = actorContextForReq(req);
      try {
        const user = await db.user.create({
          data: {
            email: parsed.data.email.toLowerCase(),
            name: parsed.data.name ?? null,
            displayName: parsed.data.displayName ?? null,
            role: parsed.data.role ?? "EXECUTOR",
            isActive: false,
          },
        });
        await appendChangeLog(db, historyCfg, "USER", user.id, actor, {
          changeKind: "UPDATE_PARENT" as ChangeKind,
          changeNote: "Invited user",
        });
        const token = randomToken(32);
        const tokenHash = sha256Hex(token);
        const expiresAt = new Date(Date.now() + config.ADMIN_MAGICLINK_TTL_MIN * 60_000);
        await db.magicLink.create({ data: { userId: user.id, tokenHash, expiresAt } });
        const devHelper = await sendMagicLinkEmail(user.email, token);
        if (devHelper?.loginUrl) {
          res.status(202).json({ loginUrl: devHelper.loginUrl });
          return;
        }
        res.sendStatus(202);
      } catch (err) {
        if (isUniqueConstraintError(err)) {
          res.status(409).json({ status: "error", code: "EMAIL_EXISTS" });
          return;
        }
        throw err;
      }
    }),
  );

  // GET /users/:id
  server.get(
    "/users/:id",
    requireAdminOrApiToken({
      policySignature: "GET /users/:id" as RouteSignature,
      scopes: [SCOPES.USERS_READ],
    })(async (req, res) => {
      const id = (req.params as Record<string, string> | undefined)?.id;
      if (!id) {
        res.status(400).json({ status: "error", code: "BAD_REQUEST" });
        return;
      }
      const row = await db.user.findUnique({ where: { id } });
      if (!row) {
        res.status(404).json({ status: "error", code: "NOT_FOUND" });
        return;
      }
      res.status(200).json(toUserDto(row));
    }),
  );

  // PATCH /users/:id
  server.patch(
    "/users/:id",
    requireAdminOrApiToken({
      policySignature: "PATCH /users/:id" as RouteSignature,
      scopes: [SCOPES.USERS_WRITE],
    })(async (req, res) => {
      const id = (req.params as Record<string, string> | undefined)?.id;
      if (!id) {
        res.status(400).json({ status: "error", code: "BAD_REQUEST" });
        return;
      }
      const Body = z.object({
        name: z.string().trim().max(200).nullish().optional(),
        displayName: z.string().trim().max(200).nullish().optional(),
        role: z.enum(ROLES).optional(),
        isActive: z.boolean().optional(),
      });
      const parsed = Body.safeParse(req.body ?? {});
      if (
        !parsed.success ||
        (parsed.data.name === undefined &&
          parsed.data.displayName === undefined &&
          parsed.data.role === undefined &&
          parsed.data.isActive === undefined)
      ) {
        res.status(400).json({ status: "error", code: "BAD_REQUEST" });
        return;
      }
      const actor = actorContextForReq(req);
      const updateData: Prisma.UserUpdateInput = {
        ...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}),
        ...(parsed.data.displayName !== undefined ? { displayName: parsed.data.displayName } : {}),
        ...(parsed.data.role !== undefined ? { role: parsed.data.role } : {}),
        ...(parsed.data.isActive !== undefined
          ? {
              isActive: parsed.data.isActive,
              deactivatedAt: parsed.data.isActive ? null : new Date(),
            }
          : {}),
      };
      const updated = await db.user.update({ where: { id }, data: updateData }).catch(() => null);
      if (!updated) {
        res.status(404).json({ status: "error", code: "NOT_FOUND" });
        return;
      }
      await appendChangeLog(db, historyCfg, "USER", id, actor, {
        changeKind: "UPDATE_PARENT" as ChangeKind,
      });
      res.sendStatus(204);
    }),
  );

  // DELETE /users/:id — prefer deactivate, return 409
  server.delete(
    "/users/:id",
    requireAdminOrApiToken({
      policySignature: "DELETE /users/:id" as RouteSignature,
      scopes: [SCOPES.USERS_WRITE],
    })(async (req, res) => {
      res.status(409).json({ status: "error", code: "DELETE_DISABLED" });
    }),
  );

  // GET /users/:id/sessions
  server.get(
    "/users/:id/sessions",
    requireAdminOrApiToken({
      policySignature: "GET /users/:id/sessions" as RouteSignature,
      scopes: [SCOPES.USERS_READ],
    })(async (req, res) => {
      const id = (req.params as Record<string, string> | undefined)?.id;
      if (!id) {
        res.status(400).json({ status: "error", code: "BAD_REQUEST" });
        return;
      }
      const user = await db.user.findUnique({ where: { id }, select: { id: true } });
      if (!user) {
        res.status(404).json({ status: "error", code: "NOT_FOUND" });
        return;
      }
      const now = new Date();
      const sessions = await db.session.findMany({
        where: { userId: id, revokedAt: null, expiresAt: { gt: now } },
        orderBy: { createdAt: "desc" },
        select: { id: true, createdAt: true, expiresAt: true, ip: true, userAgent: true },
      });
      res.status(200).json({
        items: sessions.map((s) => ({
          id: s.id,
          createdAt: s.createdAt.toISOString(),
          expiresAt: s.expiresAt.toISOString(),
          ip: s.ip ?? null,
          userAgent: s.userAgent ?? null,
        })),
      });
    }),
  );

  // POST /users/:id/revoke — revoke all sessions
  server.post(
    "/users/:id/revoke",
    requireAdminOrApiToken({
      policySignature: "POST /users/:id/revoke" as RouteSignature,
      scopes: [SCOPES.USERS_WRITE],
    })(async (req, res) => {
      const id = (req.params as Record<string, string> | undefined)?.id;
      if (!id) {
        res.status(400).json({ status: "error", code: "BAD_REQUEST" });
        return;
      }
      const user = await db.user.findUnique({ where: { id }, select: { id: true } });
      if (!user) {
        res.status(404).json({ status: "error", code: "NOT_FOUND" });
        return;
      }
      await db.session.updateMany({
        where: { userId: id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      res.sendStatus(204);
    }),
  );
}
