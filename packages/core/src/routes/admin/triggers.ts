import { z } from "zod";
import type { HttpServer } from "../../http/http-server.js";
import { getDb } from "../../db/db.js";
import type { Prisma, ChangeKind } from "@latchflow/db";
import { requireAdminOrApiToken } from "../../middleware/require-admin-or-api-token.js";
import { SCOPES } from "../../auth/scopes.js";
import type { RouteSignature } from "../../authz/policy.js";
import type { AppConfig } from "../../config/env-config.js";
import { appendChangeLog, materializeVersion } from "../../history/changelog.js";
import {
  encryptConfig,
  decryptConfig,
  type ConfigEncryptionOptions,
} from "../../plugins/config-encryption.js";
import type {
  PluginRuntimeRegistry,
  TriggerDefinitionHealth,
} from "../../plugins/plugin-loader.js";

type FireFn = (triggerDefinitionId: string, context?: Record<string, unknown>) => Promise<string>;

type ChangeLogRow = {
  version: number;
  isSnapshot: boolean;
  hash: string;
  changeNote: string | null;
  changedPath: string | null;
  changeKind: ChangeKind | null;
  createdAt: Date;
  actorType: "USER" | "ACTION" | "SYSTEM";
  actorUserId: string | null;
  actorInvocationId: string | null;
  actorActionDefinitionId: string | null;
  onBehalfOfUserId: string | null;
};

interface TriggerDeps {
  fireTriggerOnce?: FireFn;
  config?: AppConfig;
  encryption?: ConfigEncryptionOptions;
  runtime?: PluginRuntimeRegistry;
}

export function registerTriggerAdminRoutes(server: HttpServer, deps?: TriggerDeps) {
  const db = getDb();
  const defaultHistoryCfg: Pick<
    AppConfig,
    "HISTORY_SNAPSHOT_INTERVAL" | "HISTORY_MAX_CHAIN_DEPTH" | "SYSTEM_USER_ID"
  > = {
    HISTORY_SNAPSHOT_INTERVAL: 20,
    HISTORY_MAX_CHAIN_DEPTH: 200,
    SYSTEM_USER_ID: "system",
  };
  const config = deps?.config ?? defaultHistoryCfg;
  const historyCfg: Pick<AppConfig, "HISTORY_SNAPSHOT_INTERVAL" | "HISTORY_MAX_CHAIN_DEPTH"> = {
    HISTORY_SNAPSHOT_INTERVAL: config.HISTORY_SNAPSHOT_INTERVAL,
    HISTORY_MAX_CHAIN_DEPTH: config.HISTORY_MAX_CHAIN_DEPTH,
  };
  const systemUserId = config.SYSTEM_USER_ID ?? "system";
  const encryption = deps?.encryption ?? { mode: "none" as const };
  const runtime = deps?.runtime;

  const actorContextForReq = (req: unknown) => {
    const user = (req as { user?: { id?: string } }).user;
    const actorId = user?.id ?? systemUserId;
    return { actorType: "USER" as const, actorUserId: actorId };
  };

  const toIso = (value?: Date | string | null) => {
    if (!value) return undefined;
    if (value instanceof Date) return value.toISOString();
    return new Date(value).toISOString();
  };

  const formatTriggerHealth = (record?: TriggerDefinitionHealth) => {
    if (!record) return undefined;
    return {
      definitionId: record.definitionId,
      capabilityId: record.capabilityId,
      capabilityKey: record.capabilityKey,
      pluginId: record.pluginId,
      pluginName: record.pluginName,
      isRunning: record.isRunning,
      emitCount: record.emitCount,
      lastStartAt: toIso(record.lastStartAt),
      lastStopAt: toIso(record.lastStopAt),
      lastEmitAt: toIso(record.lastEmitAt),
      lastError: record.lastError
        ? { message: record.lastError.message, at: toIso(record.lastError.at)! }
        : undefined,
    };
  };

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
    config: decryptConfig(t.config, encryption) as Record<string, unknown>,
    isEnabled: t.isEnabled,
    createdAt: typeof t.createdAt === "string" ? t.createdAt : t.createdAt.toISOString(),
    updatedAt: typeof t.updatedAt === "string" ? t.updatedAt : t.updatedAt.toISOString(),
  });

  const toVersionDto = (row: ChangeLogRow) => ({
    version: row.version,
    isSnapshot: row.isSnapshot,
    hash: row.hash,
    changeNote: row.changeNote,
    changedPath: row.changedPath,
    changeKind: row.changeKind,
    createdAt: row.createdAt.toISOString(),
    actorType: row.actorType,
    actorUserId: row.actorUserId,
    actorInvocationId: row.actorInvocationId,
    actorActionDefinitionId: row.actorActionDefinitionId,
    onBehalfOfUserId: row.onBehalfOfUserId,
  });

  // GET /triggers — list
  server.get(
    "/triggers",
    requireAdminOrApiToken({
      policySignature: "GET /triggers" as RouteSignature,
      scopes: [SCOPES.TRIGGERS_READ],
    })(async (req, res) => {
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
        const capWhere: Prisma.PluginCapabilityWhereInput = { kind: "TRIGGER" };
        if (q.pluginId) capWhere.pluginId = q.pluginId;
        if (q.capabilityKey)
          capWhere.key = {
            contains: q.capabilityKey,
            mode: "insensitive",
          } as unknown as Prisma.StringFilter;
        (
          where as Prisma.TriggerDefinitionWhereInput & {
            capability?: { is?: Prisma.PluginCapabilityWhereInput | null };
          }
        ).capability = { is: capWhere };
      }
      const take = q.limit ?? 50;
      const rows = await db.triggerDefinition.findMany({
        where,
        orderBy: { id: "desc" },
        take,
        ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
      });
      const items = rows.map(toTriggerDto);
      const nextCursor = rows.length === take ? rows[rows.length - 1]?.id : undefined;
      res.status(200).json({ items, nextCursor });
    }),
  );

  // POST /triggers — create
  server.post(
    "/triggers",
    requireAdminOrApiToken({
      policySignature: "POST /triggers" as RouteSignature,
      scopes: [SCOPES.TRIGGERS_WRITE],
    })(async (req, res) => {
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
      const { name, capabilityId, config: cfg } = parsed.data;
      const capability = await db.pluginCapability.findUnique({ where: { id: capabilityId } });
      if (!capability || capability.kind !== "TRIGGER" || capability.isEnabled === false) {
        res.status(400).json({ status: "error", code: "INVALID_CAPABILITY" });
        return;
      }
      const actor = actorContextForReq(req);
      const created = await db.triggerDefinition.create({
        data: {
          name,
          capabilityId,
          config: encryptConfig(cfg, encryption),
          createdBy: actor.actorUserId,
        },
      });
      await appendChangeLog(db, historyCfg, "TRIGGER_DEFINITION", created.id, actor, {
        changeKind: "UPDATE_PARENT" as ChangeKind,
      });
      res.status(201).json(toTriggerDto(created));
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

  // GET /triggers/:id/status — runtime + event health
  server.get(
    "/triggers/:id/status",
    requireAdminOrApiToken({
      policySignature: "GET /triggers/:id/status" as RouteSignature,
      scopes: [SCOPES.TRIGGERS_READ],
    })(async (req, res) => {
      const id = (req.params as Record<string, string> | undefined)?.id;
      if (!id) {
        res.status(400).json({ status: "error", code: "BAD_REQUEST" });
        return;
      }
      const definition = await db.triggerDefinition.findUnique({
        where: { id },
        select: {
          id: true,
          name: true,
          capabilityId: true,
          isEnabled: true,
          createdAt: true,
          updatedAt: true,
        },
      });
      if (!definition) {
        res.status(404).json({ status: "error", code: "NOT_FOUND" });
        return;
      }

      const [lastEvent, eventCount] = await Promise.all([
        db.triggerEvent.findFirst({
          where: { triggerDefinitionId: id },
          orderBy: { firedAt: "desc" },
          select: { id: true, firedAt: true, context: true },
        }),
        db.triggerEvent.count({ where: { triggerDefinitionId: id } }),
      ]);

      const runtimeHealth = runtime
        ? formatTriggerHealth(runtime.getTriggerDefinitionHealth(id))
        : undefined;

      res.status(200).json({
        trigger: {
          id: definition.id,
          name: definition.name,
          capabilityId: definition.capabilityId,
          isEnabled: definition.isEnabled,
          createdAt: toIso(definition.createdAt),
          updatedAt: toIso(definition.updatedAt),
        },
        runtime: runtimeHealth,
        lastEvent: lastEvent
          ? {
              id: lastEvent.id,
              firedAt: toIso(lastEvent.firedAt),
              context: lastEvent.context,
            }
          : undefined,
        metrics: {
          eventCount,
        },
      });
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
      if (
        !parsed.success ||
        (parsed.data.name === undefined &&
          parsed.data.isEnabled === undefined &&
          parsed.data.config === undefined)
      ) {
        res.status(400).json({ status: "error", code: "BAD_REQUEST" });
        return;
      }
      const actor = actorContextForReq(req);
      const data: Prisma.TriggerDefinitionUncheckedUpdateInput = {
        ...(parsed.data.name ? { name: parsed.data.name } : {}),
        ...(typeof parsed.data.isEnabled === "boolean" ? { isEnabled: parsed.data.isEnabled } : {}),
        ...(parsed.data.config !== undefined
          ? { config: encryptConfig(parsed.data.config, encryption) }
          : {}),
        updatedBy: actor.actorUserId,
      };
      const updated = await db.triggerDefinition.update({ where: { id }, data }).catch(() => null);
      if (!updated) {
        res.status(404).json({ status: "error", code: "NOT_FOUND" });
        return;
      }
      await appendChangeLog(db, historyCfg, "TRIGGER_DEFINITION", id, actor, {
        changeKind: "UPDATE_PARENT" as ChangeKind,
      });
      res.sendStatus(204);
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
      res.sendStatus(204);
    }),
  );

  // GET /triggers/:id/versions — list changelog entries
  server.get(
    "/triggers/:id/versions",
    requireAdminOrApiToken({
      policySignature: "GET /triggers/:id/versions" as RouteSignature,
      scopes: [SCOPES.TRIGGERS_READ],
    })(async (req, res) => {
      const id = (req.params as Record<string, string> | undefined)?.id;
      if (!id) {
        res.status(400).json({ status: "error", code: "BAD_REQUEST" });
        return;
      }
      const Q = z.object({
        limit: z.coerce.number().int().min(1).max(200).optional(),
        cursor: z.coerce.number().int().min(1).optional(),
      });
      const parsed = Q.safeParse(req.query ?? {});
      const query = parsed.success ? parsed.data : {};
      const take = query.limit ?? 50;
      const rows = await db.changeLog.findMany({
        where: {
          entityType: "TRIGGER_DEFINITION",
          entityId: id,
          ...(query.cursor ? { version: { lt: query.cursor } } : {}),
        },
        orderBy: { version: "desc" },
        take,
      });
      const items = rows.map((row) =>
        toVersionDto({
          version: row.version,
          isSnapshot: row.isSnapshot,
          hash: row.hash,
          changeNote: row.changeNote,
          changedPath: row.changedPath,
          changeKind: row.changeKind as ChangeKind | null,
          createdAt: row.createdAt,
          actorType: row.actorType as "USER" | "ACTION" | "SYSTEM",
          actorUserId: row.actorUserId,
          actorInvocationId: row.actorInvocationId,
          actorActionDefinitionId: row.actorActionDefinitionId,
          onBehalfOfUserId: row.onBehalfOfUserId,
        }),
      );
      const nextCursor = rows.length === take ? rows[rows.length - 1]?.version : undefined;
      res.status(200).json({ items, nextCursor });
    }),
  );

  // GET /triggers/:id/versions/:version — materialized snapshot
  server.get(
    "/triggers/:id/versions/:version",
    requireAdminOrApiToken({
      policySignature: "GET /triggers/:id/versions/:version" as RouteSignature,
      scopes: [SCOPES.TRIGGERS_READ],
    })(async (req, res) => {
      const params = req.params as Record<string, string> | undefined;
      const id = params?.id;
      const versionNum = params?.version ? Number(params.version) : NaN;
      if (!id || Number.isNaN(versionNum) || versionNum < 1) {
        res.status(400).json({ status: "error", code: "BAD_REQUEST" });
        return;
      }
      const row = await db.changeLog.findFirst({
        where: { entityType: "TRIGGER_DEFINITION", entityId: id, version: versionNum },
      });
      if (!row) {
        res.status(404).json({ status: "error", code: "NOT_FOUND" });
        return;
      }
      const state = await materializeVersion(db, "TRIGGER_DEFINITION", id, versionNum);
      if (!state) {
        res.status(404).json({ status: "error", code: "NOT_FOUND" });
        return;
      }
      if (typeof state === "object" && state !== null) {
        const asRecord = state as Record<string, unknown>;
        if ("config" in asRecord) {
          asRecord.config = decryptConfig(asRecord.config, encryption);
        }
      }
      res.status(200).json({
        version: row.version,
        isSnapshot: row.isSnapshot,
        hash: row.hash,
        createdAt: row.createdAt.toISOString(),
        actorType: row.actorType,
        actorUserId: row.actorUserId,
        actorInvocationId: row.actorInvocationId,
        actorActionDefinitionId: row.actorActionDefinitionId,
        onBehalfOfUserId: row.onBehalfOfUserId,
        state,
      });
    }),
  );

  // POST /triggers/:id/versions — update config & record change
  server.post(
    "/triggers/:id/versions",
    requireAdminOrApiToken({
      policySignature: "POST /triggers/:id/versions" as RouteSignature,
      scopes: [SCOPES.TRIGGERS_WRITE],
    })(async (req, res) => {
      const id = (req.params as Record<string, string> | undefined)?.id;
      if (!id) {
        res.status(400).json({ status: "error", code: "BAD_REQUEST" });
        return;
      }
      const Body = z.object({
        config: z.unknown(),
        changeNote: z.string().min(1).optional(),
      });
      const parsed = Body.safeParse(req.body ?? {});
      if (!parsed.success) {
        res.status(400).json({ status: "error", code: "BAD_REQUEST" });
        return;
      }
      const actor = actorContextForReq(req);
      const patch: Prisma.TriggerDefinitionUncheckedUpdateInput = {
        config: encryptConfig(parsed.data.config, encryption),
        updatedBy: actor.actorUserId,
      };
      const updated = await db.triggerDefinition
        .update({ where: { id }, data: patch })
        .catch(() => null);
      if (!updated) {
        res.status(404).json({ status: "error", code: "NOT_FOUND" });
        return;
      }
      const entry = await appendChangeLog(db, historyCfg, "TRIGGER_DEFINITION", id, actor, {
        changeKind: "UPDATE_PARENT" as ChangeKind,
        changeNote: parsed.data.changeNote ?? null,
      });
      res.status(201).json(
        toVersionDto({
          version: entry.version,
          isSnapshot: entry.isSnapshot,
          hash: entry.hash,
          changeNote: entry.changeNote,
          changedPath: entry.changedPath,
          changeKind: entry.changeKind as ChangeKind | null,
          createdAt: entry.createdAt,
          actorType: entry.actorType as "USER" | "ACTION" | "SYSTEM",
          actorUserId: entry.actorUserId,
          actorInvocationId: entry.actorInvocationId,
          actorActionDefinitionId: entry.actorActionDefinitionId,
          onBehalfOfUserId: entry.onBehalfOfUserId,
        }),
      );
    }),
  );

  // POST /triggers/:id/versions/:version/activate — roll back to a prior config snapshot
  server.post(
    "/triggers/:id/versions/:version/activate",
    requireAdminOrApiToken({
      policySignature: "POST /triggers/:id/versions/:version/activate" as RouteSignature,
      scopes: [SCOPES.TRIGGERS_WRITE],
    })(async (req, res) => {
      const params = req.params as Record<string, string> | undefined;
      const id = params?.id;
      const versionNum = params?.version ? Number(params.version) : NaN;
      if (!id || Number.isNaN(versionNum) || versionNum < 1) {
        res.status(400).json({ status: "error", code: "BAD_REQUEST" });
        return;
      }
      const state = await materializeVersion(db, "TRIGGER_DEFINITION", id, versionNum);
      if (!state) {
        res.status(404).json({ status: "error", code: "NOT_FOUND" });
        return;
      }
      if (typeof state === "object" && state !== null && "config" in state) {
        (state as Record<string, unknown>).config = decryptConfig(
          (state as Record<string, unknown>).config,
          encryption,
        );
      }
      if (typeof (state as Record<string, unknown>).config === "undefined") {
        res.status(409).json({ status: "error", code: "MISSING_CONFIG" });
        return;
      }
      const actor = actorContextForReq(req);
      const patch: Prisma.TriggerDefinitionUncheckedUpdateInput = {
        config: encryptConfig((state as Record<string, unknown>).config, encryption),
        updatedBy: actor.actorUserId,
      };
      const updated = await db.triggerDefinition
        .update({ where: { id }, data: patch })
        .catch(() => null);
      if (!updated) {
        res.status(404).json({ status: "error", code: "NOT_FOUND" });
        return;
      }
      await appendChangeLog(db, historyCfg, "TRIGGER_DEFINITION", id, actor, {
        changeKind: "UPDATE_PARENT" as ChangeKind,
        changeNote: `Activated version ${versionNum}`,
      });
      res.sendStatus(204);
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
      const trigger = await db.triggerDefinition.findUnique({ where: { id } });
      if (!trigger) {
        res.status(404).json({ status: "error", code: "NOT_FOUND" });
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
