import { z } from "zod";
import type { HttpServer } from "../../http/http-server.js";
import { getDb } from "../../db/db.js";
import type { Prisma } from "@latchflow/db";
import { requireAdmin } from "../../middleware/require-admin.js";

export function registerPluginRoutes(server: HttpServer) {
  const db = getDb();

  // GET /plugins — list installed plugins with capabilities
  server.get("/plugins", async (req, res) => {
    try {
      await requireAdmin(req);
      const Q = z.object({
        q: z.string().optional(),
        kind: z.enum(["TRIGGER", "ACTION"]).optional(),
        capabilityKey: z.string().optional(),
        enabled: z.coerce.boolean().optional(),
        limit: z.coerce.number().int().min(1).max(200).optional(),
        cursor: z.string().optional(),
      });
      const qp = Q.safeParse(req.query ?? {});
      const q = qp.success ? qp.data : {};
      const where: Prisma.PluginWhereInput = {};
      if (q.q) {
        where.OR = [
          { name: { contains: q.q, mode: "insensitive" } },
          { description: { contains: q.q, mode: "insensitive" } },
          { author: { contains: q.q, mode: "insensitive" } },
        ];
      }
      if (q.kind || q.capabilityKey || typeof q.enabled === "boolean") {
        where.capabilities = {
          some: {
            ...(q.kind ? { kind: q.kind } : {}),
            ...(typeof q.enabled === "boolean" ? { isEnabled: q.enabled } : {}),
            ...(q.capabilityKey ? { key: { contains: q.capabilityKey, mode: "insensitive" } } : {}),
          },
        };
      }
      const items = await db.plugin.findMany({
        where,
        orderBy: { id: "desc" },
        take: q.limit ?? 50,
        ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
        include: {
          capabilities: {
            select: {
              id: true,
              kind: true,
              key: true,
              displayName: true,
              jsonSchema: true,
              isEnabled: true,
            },
          },
        },
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

  // POST /plugins/install — async install trigger
  server.post("/plugins/install", async (req, res) => {
    try {
      await requireAdmin(req);
      const Body = z.object({ source: z.string().min(1), verifySignature: z.boolean().optional() });
      const parsed = Body.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ status: "error", code: "BAD_REQUEST", message: "Invalid body" });
        return;
      }
      // For now, acknowledge and return 202. Actual install handled out-of-band.
      res.status(202).json({});
    } catch (e) {
      const err = e as Error & { status?: number };
      res
        .status(err.status ?? 401)
        .json({ status: "error", code: "UNAUTHORIZED", message: err.message });
    }
  });

  // DELETE /plugins/{pluginId}
  server.delete("/plugins/:pluginId", async (req, res) => {
    try {
      await requireAdmin(req);
      const Params = z.object({ pluginId: z.string().min(1) });
      const parsed = Params.safeParse(req.params);
      if (!parsed.success) {
        res.status(400).json({ status: "error", code: "BAD_REQUEST", message: "Invalid params" });
        return;
      }
      const { pluginId } = parsed.data as { pluginId: string };
      await db.plugin.delete({ where: { id: pluginId } }).catch(async () => {
        // If delete throws (e.g. not found), fall back to deleteMany for idempotency
        await db.plugin.deleteMany({ where: { id: pluginId } });
      });
      res.status(204).json({});
    } catch (e) {
      const err = e as Error & { status?: number };
      res
        .status(err.status ?? 401)
        .json({ status: "error", code: "UNAUTHORIZED", message: err.message });
    }
  });

  // GET /capabilities — consolidated list across plugins
  server.get("/capabilities", async (req, res) => {
    try {
      await requireAdmin(req);
      const Q = z.object({
        kind: z.enum(["TRIGGER", "ACTION"]).optional(),
        key: z.string().optional(),
        pluginId: z.string().uuid().optional(),
        enabled: z.coerce.boolean().optional(),
        limit: z.coerce.number().int().min(1).max(200).optional(),
        cursor: z.string().optional(),
      });
      const qp = Q.safeParse(req.query ?? {});
      const q = qp.success ? qp.data : {};
      const where: Prisma.PluginCapabilityWhereInput = {};
      if (q.kind) where.kind = q.kind;
      if (q.key) where.key = { contains: q.key, mode: "insensitive" };
      if (typeof q.enabled === "boolean") where.isEnabled = q.enabled;
      if (q.pluginId) where.pluginId = q.pluginId;
      const caps = await db.pluginCapability.findMany({
        where,
        orderBy: { id: "desc" },
        take: q.limit ?? 50,
        ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
        select: {
          id: true,
          kind: true,
          key: true,
          displayName: true,
          jsonSchema: true,
          isEnabled: true,
        },
      });
      const nextCursor = caps.length === (q.limit ?? 50) ? caps[caps.length - 1]?.id : undefined;
      res.status(200).json({ items: caps, nextCursor });
    } catch (e) {
      const err = e as Error & { status?: number };
      res
        .status(err.status ?? 401)
        .json({ status: "error", code: "UNAUTHORIZED", message: err.message });
    }
  });
}
