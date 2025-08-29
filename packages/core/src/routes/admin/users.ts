import { z } from "zod";
import type { HttpServer } from "../../http/http-server.js";
import { getDb } from "../../db/db.js";
import { requireAdmin } from "../../middleware/require-admin.js";
import type { Prisma } from "@latchflow/db";
import { $Enums } from "@latchflow/db";
import { randomToken, sha256Hex } from "../../auth/tokens.js";
import type { AppConfig } from "../../config/config.js";

export function registerUserAdminRoutes(server: HttpServer, config: AppConfig) {
  const db = getDb();

  // Helper to assert caller is ADMIN
  async function assertAdmin(req: Express.Request) {
    const { user } = await requireAdmin(req);
    const roles = (user as unknown as { roles: string[] }).roles ?? [];
    if (!roles.includes("ADMIN")) {
      const err = new Error("Insufficient role") as Error & { status: number };
      err.status = 403;
      throw err;
    }
    return user as unknown as { id: string; email: string; roles: $Enums.UserRole[] };
  }

  // GET /users — list/search
  server.get("/users", async (req, res) => {
    try {
      await assertAdmin(req);
      const Q = z.object({
        q: z.string().optional(),
        limit: z.coerce.number().int().min(1).max(200).optional(),
        cursor: z.string().optional(),
      });
      const qp = Q.safeParse(req.query ?? {});
      const q = qp.success ? qp.data : {};
      const where: Prisma.UserWhereInput = {};
      if (q.q) {
        where.OR = [
          { email: { contains: q.q, mode: "insensitive" } },
          { name: { contains: q.q, mode: "insensitive" } },
        ];
      }
      const items = await db.user.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: q.limit ?? 50,
        ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
        select: { id: true, email: true, name: true, roles: true, createdAt: true },
      });
      const nextCursor = items.length === (q.limit ?? 50) ? items[items.length - 1]?.id : undefined;
      res.status(200).json({ items, nextCursor });
    } catch (e) {
      const err = e as Error & { status?: number };
      res
        .status(err.status ?? 401)
        .json({ status: "error", code: "UNAUTHORIZED", message: err.message });
    }
  });

  // POST /users/invite — upsert + roles union + issue magic link
  server.post("/users/invite", async (req, res) => {
    try {
      await assertAdmin(req);
      const Body = z.object({
        email: z.string().email(),
        roles: z
          .array(
            z.enum([$Enums.UserRole.ADMIN, $Enums.UserRole.EXECUTOR, $Enums.UserRole.RECIPIENT]),
          )
          .optional(),
      });
      const parsed = Body.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ status: "error", code: "BAD_REQUEST", message: "Invalid body" });
        return;
      }
      const { email, roles: desired } = parsed.data;
      const existing = await db.user.findUnique({
        where: { email },
        select: { id: true, roles: true },
      });
      const nextRoles = existing
        ? (Array.from(
            new Set([...(existing.roles ?? []), ...(desired ?? [$Enums.UserRole.EXECUTOR])]),
          ) as $Enums.UserRole[])
        : ((desired && desired.length ? desired : [$Enums.UserRole.EXECUTOR]) as $Enums.UserRole[]);
      const user = existing
        ? await db.user.update({ where: { id: existing.id }, data: { roles: nextRoles } })
        : await db.user.create({ data: { email, roles: nextRoles } });

      const token = randomToken(32);
      const tokenHash = sha256Hex(token);
      const expiresAt = new Date(Date.now() + config.ADMIN_MAGICLINK_TTL_MIN * 60_000);
      await db.magicLink.create({ data: { userId: user.id, tokenHash, expiresAt } });
      res.status(201).json({ login_url: `/auth/admin/callback?token=${token}` });
    } catch (e) {
      const err = e as Error & { status?: number };
      res
        .status(err.status ?? 401)
        .json({ status: "error", code: "UNAUTHORIZED", message: err.message });
    }
  });

  // POST /users/{id}/roles — set roles with last-admin guard (using POST in our server adapter)
  server.post("/users/:id/roles", async (req, res) => {
    try {
      await assertAdmin(req);
      const Params = z.object({ id: z.string().uuid() });
      const p = Params.safeParse(req.params);
      if (!p.success) {
        res.status(400).json({ status: "error", code: "BAD_REQUEST", message: "Invalid params" });
        return;
      }
      const Body = z.object({
        roles: z.array(
          z.enum([$Enums.UserRole.ADMIN, $Enums.UserRole.EXECUTOR, $Enums.UserRole.RECIPIENT]),
        ),
      });
      const b = Body.safeParse(req.body);
      if (!b.success) {
        res.status(400).json({ status: "error", code: "BAD_REQUEST", message: "Invalid body" });
        return;
      }
      const user = await db.user.findUnique({ where: { id: p.data.id } });
      if (!user) {
        res.status(404).json({ status: "error", code: "NOT_FOUND", message: "User not found" });
        return;
      }
      const incoming = b.data.roles as $Enums.UserRole[];
      const removingAdmin =
        (user.roles ?? []).includes($Enums.UserRole.ADMIN) &&
        !incoming.includes($Enums.UserRole.ADMIN);
      if (removingAdmin) {
        const admins = await db.user.count({ where: { roles: { has: $Enums.UserRole.ADMIN } } });
        if (admins <= 1) {
          res
            .status(409)
            .json({ status: "error", code: "LAST_ADMIN", message: "Cannot remove last ADMIN" });
          return;
        }
      }
      await db.user.update({ where: { id: user.id }, data: { roles: incoming } });
      res.status(204).json({});
    } catch (e) {
      const err = e as Error & { status?: number };
      res
        .status(err.status ?? 401)
        .json({ status: "error", code: "UNAUTHORIZED", message: err.message });
    }
  });

  // POST /users/{id}/revoke — revoke sessions and/or CLI tokens
  server.post("/users/:id/revoke", async (req, res) => {
    try {
      await assertAdmin(req);
      const Params = z.object({ id: z.string().uuid() });
      const p = Params.safeParse(req.params);
      if (!p.success) {
        res.status(400).json({ status: "error", code: "BAD_REQUEST", message: "Invalid params" });
        return;
      }
      const Body = z.object({ sessions: z.boolean().optional(), tokens: z.boolean().optional() });
      const b = Body.safeParse(req.body ?? {});
      if (!b.success) {
        res.status(400).json({ status: "error", code: "BAD_REQUEST", message: "Invalid body" });
        return;
      }
      const sessions = b.data.sessions ?? true;
      const tokens = b.data.tokens ?? true;
      const target = await db.user.findUnique({ where: { id: p.data.id } });
      if (!target) {
        res.status(404).json({ status: "error", code: "NOT_FOUND", message: "User not found" });
        return;
      }
      const isLastAdmin = (target.roles ?? []).includes($Enums.UserRole.ADMIN)
        ? (await db.user.count({ where: { roles: { has: $Enums.UserRole.ADMIN } } })) <= 1
        : false;
      if (isLastAdmin) {
        res
          .status(409)
          .json({ status: "error", code: "LAST_ADMIN", message: "Cannot revoke last ADMIN" });
        return;
      }
      if (sessions) {
        await db.session.updateMany({
          where: { userId: target.id, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      }
      if (tokens) {
        await db.apiToken.updateMany({
          where: { userId: target.id, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      }
      res.status(204).json({});
    } catch (e) {
      const err = e as Error & { status?: number };
      res
        .status(err.status ?? 401)
        .json({ status: "error", code: "UNAUTHORIZED", message: err.message });
    }
  });
}
