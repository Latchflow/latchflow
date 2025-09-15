import { z } from "zod";
import type { HttpServer } from "../../http/http-server.js";
import { getDb } from "../../db/db.js";
import type { Prisma, ChangeKind } from "@latchflow/db";
import { requireAdminOrApiToken } from "../../middleware/require-admin-or-api-token.js";
import { SCOPES } from "../../auth/scopes.js";
import type { RouteSignature } from "../../authz/policy.js";
import type { AppConfig } from "../../config/config.js";
import { appendChangeLog } from "../../history/changelog.js";

type FireFn = (triggerDefinitionId: string, context?: Record<string, unknown>) => Promise<void>;

export function registerTriggerAdminRoutes(
  server: HttpServer,
  deps?: { fireTriggerOnce?: FireFn; config?: AppConfig },
) {
  const db = getDb();
  const defaultHistoryCfg: Pick<
    AppConfig,
    "HISTORY_SNAPSHOT_INTERVAL" | "HISTORY_MAX_CHAIN_DEPTH"
  > = { HISTORY_SNAPSHOT_INTERVAL: 20, HISTORY_MAX_CHAIN_DEPTH: 200 };
  const historyCfg: Pick<AppConfig, "HISTORY_SNAPSHOT_INTERVAL" | "HISTORY_MAX_CHAIN_DEPTH"> =
    deps?.config ?? defaultHistoryCfg;
  const systemUserId = deps?.config?.SYSTEM_USER_ID ?? "system";

  const toTriggerDto = (t: {
    id: string;
    name: string;
    capabilityId: string;
    config: unknown;
    isEnabled: boolean;
    createdAt: Date | string;
    updatedAt: Date | string;
  }) => ({
    id: t.id,
    name: t.name,
    capabilityId: t.capabilityId,
    config: t.config as Record<string, unknown>,
    isEnabled: t.isEnabled,
    createdAt: typeof t.createdAt === "string" ? t.createdAt : t.createdAt.toISOString(),
    updatedAt: typeof t.updatedAt === "string" ? t.updatedAt : t.updatedAt.toISOString(),
  });

  // GET /triggers — list
  server.get(
    "/triggers",
    requireAdminOrApiToken({
      policySignature: "GET /triggers" as RouteSignature,
      scopes: [SCOPES.TRIGGERS_READ],
    })(async (req, res) => {
      try {
        const Q = z.object({
          limit: z.coerce.number().int().min(1).max(200).optional(),
          cursor: z.string().optional(),
          q: z.string().optional(),
          pluginId: z.string().optional(),
          capabilityKey: z.string().optional(),
          enabled: z.coerce.boolean().optional(),
          updatedSince: z.coerce.date().optional(),
        });
        const qp = Q.safeParse(req.query ?? {});
        const q = qp.success ? qp.data : {};
        const where: Prisma.TriggerDefinitionWhereInput = {};
        if (q.q) where.name = { contains: q.q, mode: "insensitive" };
        if (typeof q.enabled === "boolean") where.isEnabled = q.enabled;
        if (q.updatedSince) where.updatedAt = { gte: q.updatedSince };
        if (q.pluginId || q.capabilityKey) {
          const capWhere: Prisma.PluginCapabilityWhereInput = {};
          if (q.pluginId) capWhere.pluginId = q.pluginId;
          if (q.capabilityKey)
            capWhere.key = {
              contains: q.capabilityKey,
              mode: "insensitive",
            } as unknown as Prisma.StringFilter;
          // Relational filter: to-one relation uses `is`
          (
            where as Prisma.TriggerDefinitionWhereInput & {
              capability?: { is?: Prisma.PluginCapabilityWhereInput | null };
            }
          ).capability = { is: capWhere };
        }
        const rows = await db.triggerDefinition.findMany({
          where,
          orderBy: { id: "desc" },
          take: q.limit ?? 50,
          ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
        });
        const items = rows.map(toTriggerDto);
        const nextCursor = rows.length === (q.limit ?? 50) ? rows[rows.length - 1]?.id : undefined;
        res.status(200).json({ items, nextCursor });
      } catch (e) {
        const err = e as Error & { status?: number };
        res
          .status(err.status ?? 401)
          .json({ status: "error", code: "UNAUTHORIZED", message: err.message });
      }
    }),
  );

  // POST /triggers — create
  server.post(
    "/triggers",
    requireAdminOrApiToken({
      policySignature: "POST /triggers" as RouteSignature,
      scopes: [SCOPES.TRIGGERS_WRITE],
    })(async (req, res) => {
      try {
        const Body = z.object({
          name: z.string().min(1),
          capabilityId: z.string().min(1),
          config: z.unknown(),
        });
        const parsed = Body.safeParse(req.body ?? {});
        if (!parsed.success) {
          res.status(400).json({ status: "error", code: "BAD_REQUEST", message: "Invalid body" });
          return;
        }
        const { name, capabilityId, config } = parsed.data;
        // Validate capability exists and is a TRIGGER
        const cap = await db.pluginCapability.findUnique({ where: { id: capabilityId } });
        if (!cap || cap.kind !== "TRIGGER" || cap.isEnabled === false) {
          res.status(400).json({ status: "error", code: "INVALID_CAPABILITY" });
          return;
        }
        const userId = ((req as unknown as { user?: { id?: string } }).user?.id ??
          systemUserId) as string;
        const created = await db.triggerDefinition.create({
          data: {
            name,
            capabilityId,
            config: config as unknown as Prisma.InputJsonValue,
            createdBy: userId,
          },
        });
        // ChangeLog
        await appendChangeLog(
          db,
          historyCfg,
          "TRIGGER_DEFINITION",
          created.id,
          { actorType: "USER", actorUserId: userId },
          { changeKind: "UPDATE_PARENT" as ChangeKind },
        );
        res.status(201).json(toTriggerDto(created));
      } catch (e) {
        const err = e as Error & { status?: number };
        res
          .status(err.status ?? 401)
          .json({ status: "error", code: "UNAUTHORIZED", message: err.message });
      }
    }),
  );

  // GET /triggers/:id — get by id
  server.get(
    "/triggers/:id",
    requireAdminOrApiToken({
      policySignature: "GET /triggers/:id" as RouteSignature,
      scopes: [SCOPES.TRIGGERS_READ],
    })(async (req, res) => {
      const id = (req.params as Record<string, string> | undefined)?.id;
      if (!id) {
        res.status(400).json({ status: "error", code: "BAD_REQUEST" });
        return;
      }
      const row = await db.triggerDefinition.findUnique({ where: { id } });
      if (!row) {
        res.status(404).json({ status: "error", code: "NOT_FOUND" });
        return;
      }
      res.status(200).json(toTriggerDto(row));
    }),
  );

  // PATCH /triggers/:id — update
  server.patch(
    "/triggers/:id",
    requireAdminOrApiToken({
      policySignature: "PATCH /triggers/:id" as RouteSignature,
      scopes: [SCOPES.TRIGGERS_WRITE],
    })(async (req, res) => {
      const id = (req.params as Record<string, string> | undefined)?.id;
      if (!id) {
        res.status(400).json({ status: "error", code: "BAD_REQUEST" });
        return;
      }
      const Body = z.object({
        name: z.string().min(1).optional(),
        isEnabled: z.boolean().optional(),
        config: z.unknown().optional(),
      });
      const parsed = Body.safeParse(req.body ?? {});
      if (!parsed.success) {
        res.status(400).json({ status: "error", code: "BAD_REQUEST" });
        return;
      }
      const userId = ((req as unknown as { user?: { id?: string } }).user?.id ??
        systemUserId) as string;
      const data: Prisma.TriggerDefinitionUpdateInput = {
        ...(parsed.data.name ? { name: parsed.data.name } : {}),
        ...(typeof parsed.data.isEnabled === "boolean" ? { isEnabled: parsed.data.isEnabled } : {}),
        ...(parsed.data.config !== undefined
          ? { config: parsed.data.config as unknown as Prisma.InputJsonValue }
          : {}),
      };
      const updated = await db.triggerDefinition.update({ where: { id }, data }).catch(() => null);
      if (!updated) {
        res.status(404).json({ status: "error", code: "NOT_FOUND" });
        return;
      }
      await appendChangeLog(
        db,
        historyCfg,
        "TRIGGER_DEFINITION",
        id,
        { actorType: "USER", actorUserId: userId },
        { changeKind: "UPDATE_PARENT" as ChangeKind },
      );
      res.status(204).json({});
    }),
  );

  // DELETE /triggers/:id — delete (409 when in use)
  server.delete(
    "/triggers/:id",
    requireAdminOrApiToken({
      policySignature: "DELETE /triggers/:id" as RouteSignature,
      scopes: [SCOPES.TRIGGERS_WRITE],
    })(async (req, res) => {
      const id = (req.params as Record<string, string> | undefined)?.id;
      if (!id) {
        res.status(400).json({ status: "error", code: "BAD_REQUEST" });
        return;
      }
      const [evtCount, linkCount] = await Promise.all([
        db.triggerEvent.count({ where: { triggerDefinitionId: id } }),
        db.pipelineTrigger.count({ where: { triggerId: id } }),
      ]);
      if (evtCount > 0 || linkCount > 0) {
        res.status(409).json({ status: "error", code: "IN_USE" });
        return;
      }
      const ok = await db.triggerDefinition
        .delete({ where: { id } })
        .then(() => true)
        .catch(() => false);
      if (!ok) {
        res.status(404).json({ status: "error", code: "NOT_FOUND" });
        return;
      }
      res.status(204).json({});
    }),
  );

  // POST /triggers/:id/test-fire — optional utility
  server.post(
    "/triggers/:id/test-fire",
    requireAdminOrApiToken({
      policySignature: "POST /triggers/:id/test-fire" as RouteSignature,
      scopes: [SCOPES.TRIGGERS_WRITE],
    })(async (req, res) => {
      const id = (req.params as Record<string, string> | undefined)?.id;
      if (!id) {
        res.status(400).json({ status: "error", code: "BAD_REQUEST" });
        return;
      }
      const Body = z.object({ context: z.record(z.any()).optional() });
      const parsed = Body.safeParse(req.body ?? {});
      const context = parsed.success && parsed.data.context ? parsed.data.context : {};
      if (!deps?.fireTriggerOnce) {
        res.status(503).json({ status: "error", code: "TRIGGER_RUNNER_UNAVAILABLE" });
        return;
      }
      await deps.fireTriggerOnce(id, context);
      res.status(202).json({});
    }),
  );
}
