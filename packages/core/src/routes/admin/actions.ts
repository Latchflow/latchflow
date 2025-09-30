import { z } from "zod";
import type { HttpServer } from "../../http/http-server.js";
import { getDb } from "../../db/db.js";
import type { Prisma, ChangeKind } from "@latchflow/db";
import { requireAdminOrApiToken } from "../../middleware/require-admin-or-api-token.js";
import { SCOPES } from "../../auth/scopes.js";
import type { RouteSignature } from "../../authz/policy.js";
import type { AppConfig } from "../../config/env-config.js";
import { appendChangeLog, materializeVersion } from "../../history/changelog.js";
import type { LatchflowQueue } from "../../queue/types.js";

import {
  encryptConfig,
  decryptConfig,
  type ConfigEncryptionOptions,
} from "../../plugins/config-encryption.js";

interface ActionDeps {
  queue?: Pick<LatchflowQueue, "enqueueAction">;
  config?: AppConfig;
  encryption?: ConfigEncryptionOptions;
}

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

export function registerActionAdminRoutes(server: HttpServer, deps?: ActionDeps) {
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

  const toActionDto = (a: {
    id: string;
    name: string;
    capabilityId: string;
    config: unknown;
    isEnabled: boolean;
    createdAt: Date | string;
    updatedAt: Date | string;
  }) => ({
    id: a.id,
    name: a.name,
    capabilityId: a.capabilityId,
    config: decryptConfig(a.config, encryption) as Record<string, unknown>,
    isEnabled: a.isEnabled,
    createdAt: typeof a.createdAt === "string" ? a.createdAt : a.createdAt.toISOString(),
    updatedAt: typeof a.updatedAt === "string" ? a.updatedAt : a.updatedAt.toISOString(),
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

  const actorContextForReq = (req: unknown) => {
    const user = (req as { user?: { id?: string } }).user;
    const actorId = user?.id ?? systemUserId;
    return { actorType: "USER" as const, actorUserId: actorId };
  };

  // GET /actions — list definitions
  server.get(
    "/actions",
    requireAdminOrApiToken({
      policySignature: "GET /actions" as RouteSignature,
      scopes: [SCOPES.ACTIONS_READ],
    })(async (req, res) => {
      const Q = z.object({
        limit: z.coerce.number().int().min(1).max(200).optional(),
        cursor: z.string().optional(),
        q: z.string().optional(),
        pluginId: z.string().optional(),
        kind: z.string().optional(),
        enabled: z.coerce.boolean().optional(),
        updatedSince: z.coerce.date().optional(),
      });
      const parsed = Q.safeParse(req.query ?? {});
      const query = parsed.success ? parsed.data : {};
      const where: Prisma.ActionDefinitionWhereInput = {};
      if (query.q) where.name = { contains: query.q, mode: "insensitive" };
      if (typeof query.enabled === "boolean") where.isEnabled = query.enabled;
      if (query.updatedSince) where.updatedAt = { gte: query.updatedSince };
      if (query.pluginId || query.kind) {
        const capWhere: Prisma.PluginCapabilityWhereInput = { kind: "ACTION" };
        if (query.pluginId) capWhere.pluginId = query.pluginId;
        if (query.kind) {
          capWhere.key = {
            contains: query.kind,
            mode: "insensitive",
          } as unknown as Prisma.StringFilter;
        }
        (
          where as Prisma.ActionDefinitionWhereInput & {
            capability?: { is?: Prisma.PluginCapabilityWhereInput };
          }
        ).capability = {
          is: capWhere,
        };
      }

      const take = query.limit ?? 50;
      const rows = await db.actionDefinition.findMany({
        where,
        orderBy: { id: "desc" },
        take,
        ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      });
      const items = rows.map(toActionDto);
      const nextCursor = rows.length === take ? rows[rows.length - 1]?.id : undefined;
      res.status(200).json({ items, nextCursor });
    }),
  );

  // POST /actions — create definition
  server.post(
    "/actions",
    requireAdminOrApiToken({
      policySignature: "POST /actions" as RouteSignature,
      scopes: [SCOPES.ACTIONS_WRITE],
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
      if (!capability || capability.kind !== "ACTION" || capability.isEnabled === false) {
        res.status(400).json({ status: "error", code: "INVALID_CAPABILITY" });
        return;
      }
      const actor = actorContextForReq(req);
      const created = await db.actionDefinition.create({
        data: {
          name,
          capabilityId,
          config: encryptConfig(cfg, encryption),
          createdBy: actor.actorUserId,
        },
      });
      await appendChangeLog(db, historyCfg, "ACTION_DEFINITION", created.id, actor, {
        changeKind: "UPDATE_PARENT" as ChangeKind,
      });
      res.status(201).json(toActionDto(created));
    }),
  );

  // GET /actions/:id — fetch definition
  server.get(
    "/actions/:id",
    requireAdminOrApiToken({
      policySignature: "GET /actions/:id" as RouteSignature,
      scopes: [SCOPES.ACTIONS_READ],
    })(async (req, res) => {
      const id = (req.params as Record<string, string> | undefined)?.id;
      if (!id) {
        res.status(400).json({ status: "error", code: "BAD_REQUEST" });
        return;
      }
      const row = await db.actionDefinition.findUnique({ where: { id } });
      if (!row) {
        res.status(404).json({ status: "error", code: "NOT_FOUND" });
        return;
      }
      res.status(200).json(toActionDto(row));
    }),
  );

  // PATCH /actions/:id — update metadata
  server.patch(
    "/actions/:id",
    requireAdminOrApiToken({
      policySignature: "PATCH /actions/:id" as RouteSignature,
      scopes: [SCOPES.ACTIONS_WRITE],
    })(async (req, res) => {
      const id = (req.params as Record<string, string> | undefined)?.id;
      if (!id) {
        res.status(400).json({ status: "error", code: "BAD_REQUEST" });
        return;
      }
      const Body = z.object({
        name: z.string().min(1).optional(),
        isEnabled: z.boolean().optional(),
      });
      const parsed = Body.safeParse(req.body ?? {});
      if (!parsed.success || (!parsed.data.name && parsed.data.isEnabled === undefined)) {
        res.status(400).json({ status: "error", code: "BAD_REQUEST" });
        return;
      }
      const actor = actorContextForReq(req);
      const patch: Prisma.ActionDefinitionUncheckedUpdateInput = {
        ...(parsed.data.name ? { name: parsed.data.name } : {}),
        ...(parsed.data.isEnabled !== undefined ? { isEnabled: parsed.data.isEnabled } : {}),
        updatedBy: actor.actorUserId,
      };
      const updated = await db.actionDefinition
        .update({ where: { id }, data: patch })
        .catch(() => null);
      if (!updated) {
        res.status(404).json({ status: "error", code: "NOT_FOUND" });
        return;
      }
      await appendChangeLog(db, historyCfg, "ACTION_DEFINITION", id, actor, {
        changeKind: "UPDATE_PARENT" as ChangeKind,
      });
      res.status(204).json({});
    }),
  );

  // DELETE /actions/:id — remove when unused
  server.delete(
    "/actions/:id",
    requireAdminOrApiToken({
      policySignature: "DELETE /actions/:id" as RouteSignature,
      scopes: [SCOPES.ACTIONS_WRITE],
    })(async (req, res) => {
      const id = (req.params as Record<string, string> | undefined)?.id;
      if (!id) {
        res.status(400).json({ status: "error", code: "BAD_REQUEST" });
        return;
      }
      const [invocations, pipelineSteps] = await Promise.all([
        db.actionInvocation.count({ where: { actionDefinitionId: id } }),
        db.pipelineStep.count({ where: { actionId: id } }),
      ]);
      if (invocations > 0 || pipelineSteps > 0) {
        res.status(409).json({ status: "error", code: "IN_USE" });
        return;
      }
      const deleted = await db.actionDefinition
        .delete({ where: { id } })
        .then(() => true)
        .catch(() => false);
      if (!deleted) {
        res.status(404).json({ status: "error", code: "NOT_FOUND" });
        return;
      }
      res.sendStatus(204);
    }),
  );

  // GET /actions/:id/versions — list changelog entries
  server.get(
    "/actions/:id/versions",
    requireAdminOrApiToken({
      policySignature: "GET /actions/:id/versions" as RouteSignature,
      scopes: [SCOPES.ACTIONS_READ],
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
          entityType: "ACTION_DEFINITION",
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

  // GET /actions/:id/versions/:version — materialized view
  server.get(
    "/actions/:id/versions/:version",
    requireAdminOrApiToken({
      policySignature: "GET /actions/:id/versions/:version" as RouteSignature,
      scopes: [SCOPES.ACTIONS_READ],
    })(async (req, res) => {
      const params = req.params as Record<string, string> | undefined;
      const id = params?.id;
      const versionNum = params?.version ? Number(params.version) : NaN;
      if (!id || Number.isNaN(versionNum) || versionNum < 1) {
        res.status(400).json({ status: "error", code: "BAD_REQUEST" });
        return;
      }
      const row = await db.changeLog.findFirst({
        where: { entityType: "ACTION_DEFINITION", entityId: id, version: versionNum },
      });
      if (!row) {
        res.status(404).json({ status: "error", code: "NOT_FOUND" });
        return;
      }
      const state = await materializeVersion(db, "ACTION_DEFINITION", id, versionNum);
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

  // POST /actions/:id/versions — create a new version (update config)
  server.post(
    "/actions/:id/versions",
    requireAdminOrApiToken({
      policySignature: "POST /actions/:id/versions" as RouteSignature,
      scopes: [SCOPES.ACTIONS_WRITE],
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
      const patch: Prisma.ActionDefinitionUncheckedUpdateInput = {
        config: encryptConfig(parsed.data.config, encryption),
        updatedBy: actor.actorUserId,
      };
      const updated = await db.actionDefinition
        .update({ where: { id }, data: patch })
        .catch(() => null);
      if (!updated) {
        res.status(404).json({ status: "error", code: "NOT_FOUND" });
        return;
      }
      const entry = await appendChangeLog(db, historyCfg, "ACTION_DEFINITION", id, actor, {
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

  // POST /actions/:id/versions/:version/activate — roll back to a previous config snapshot
  server.post(
    "/actions/:id/versions/:version/activate",
    requireAdminOrApiToken({
      policySignature: "POST /actions/:id/versions/:version/activate" as RouteSignature,
      scopes: [SCOPES.ACTIONS_WRITE],
    })(async (req, res) => {
      const params = req.params as Record<string, string> | undefined;
      const id = params?.id;
      const versionNum = params?.version ? Number(params.version) : NaN;
      if (!id || Number.isNaN(versionNum) || versionNum < 1) {
        res.status(400).json({ status: "error", code: "BAD_REQUEST" });
        return;
      }
      const state = await materializeVersion(db, "ACTION_DEFINITION", id, versionNum);
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
      const patch: Prisma.ActionDefinitionUncheckedUpdateInput = {
        config: encryptConfig((state as Record<string, unknown>).config, encryption),
        updatedBy: actor.actorUserId,
      };
      const updated = await db.actionDefinition
        .update({ where: { id }, data: patch })
        .catch(() => null);
      if (!updated) {
        res.status(404).json({ status: "error", code: "NOT_FOUND" });
        return;
      }
      await appendChangeLog(db, historyCfg, "ACTION_DEFINITION", id, actor, {
        changeKind: "UPDATE_PARENT" as ChangeKind,
        changeNote: `Activated version ${versionNum}`,
      });
      res.sendStatus(204);
    }),
  );

  // POST /actions/:id/test-run — enqueue manual invocation
  server.post(
    "/actions/:id/test-run",
    requireAdminOrApiToken({
      policySignature: "POST /actions/:id/test-run" as RouteSignature,
      scopes: [SCOPES.ACTIONS_WRITE],
    })(async (req, res) => {
      if (!deps?.queue) {
        res.status(503).json({ status: "error", code: "QUEUE_UNAVAILABLE" });
        return;
      }
      const params = req.params as Record<string, string> | undefined;
      const id = params?.id;
      if (!id) {
        res.status(400).json({ status: "error", code: "BAD_REQUEST" });
        return;
      }
      const action = await db.actionDefinition.findUnique({ where: { id } });
      if (!action) {
        res.status(404).json({ status: "error", code: "NOT_FOUND" });
        return;
      }
      const Body = z.object({ context: z.record(z.unknown()).optional() });
      const parsed = Body.safeParse(req.body ?? {});
      if (!parsed.success) {
        res.status(400).json({ status: "error", code: "BAD_REQUEST" });
        return;
      }
      const context = parsed.data.context ?? {};
      const userId = actorContextForReq(req).actorUserId;
      await deps.queue.enqueueAction({
        actionDefinitionId: id,
        triggerEventId: undefined,
        manualInvokerId: userId,
        context,
      });
      res.sendStatus(202);
    }),
  );
}
