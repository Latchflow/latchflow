import { z } from "zod";
import type { HttpServer } from "../../http/http-server.js";
import { getDb } from "../../db/db.js";
import type { Prisma } from "@latchflow/db";
import type {
  PluginRuntimeRegistry,
  TriggerDefinitionHealth,
  ActionDefinitionHealth,
} from "../../plugins/plugin-loader.js";
import { type RouteSignature } from "../../authz/policy.js";
import { requireAdminOrApiToken } from "../../middleware/require-admin-or-api-token.js";
import { SCOPES } from "../../auth/scopes.js";

export function registerPluginRoutes(
  server: HttpServer,
  deps?: { runtime?: PluginRuntimeRegistry },
) {
  const db = getDb();
  const runtime = deps?.runtime;

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

  const formatActionHealth = (record?: ActionDefinitionHealth) => {
    if (!record) return undefined;
    return {
      definitionId: record.definitionId,
      capabilityId: record.capabilityId,
      capabilityKey: record.capabilityKey,
      pluginId: record.pluginId,
      pluginName: record.pluginName,
      lastStatus: record.lastStatus,
      lastInvocationAt: toIso(record.lastInvocationAt),
      lastDurationMs: record.lastDurationMs,
      successCount: record.successCount,
      retryCount: record.retryCount,
      failureCount: record.failureCount,
      skippedCount: record.skippedCount,
      lastError: record.lastError
        ? { message: record.lastError.message, at: toIso(record.lastError.at)! }
        : undefined,
    };
  };

  // GET /plugins — list installed plugins with capabilities
  server.get(
    "/plugins",
    requireAdminOrApiToken({
      policySignature: "GET /plugins" as RouteSignature,
      scopes: [SCOPES.CORE_READ],
    })(async (req, res) => {
      try {
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
              ...(q.capabilityKey
                ? { key: { contains: q.capabilityKey, mode: "insensitive" } }
                : {}),
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
        const nextCursor =
          items.length === (q.limit ?? 50) ? items[items.length - 1]?.id : undefined;
        res.status(200).json({ items, nextCursor });
      } catch (e) {
        const err = e as Error & { status?: number };
        res
          .status(err.status ?? 401)
          .json({ status: "error", code: "UNAUTHORIZED", message: err.message });
      }
    }),
  );

  // POST /plugins/install — async install trigger
  server.post(
    "/plugins/install",
    requireAdminOrApiToken({
      policySignature: "POST /plugins/install" as RouteSignature,
      scopes: [SCOPES.CORE_WRITE],
    })(async (req, res) => {
      try {
        const Body = z.object({
          source: z.string().min(1),
          verifySignature: z.boolean().optional(),
        });
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
    }),
  );

  // DELETE /plugins/{pluginId}
  server.delete(
    "/plugins/:pluginId",
    requireAdminOrApiToken({
      policySignature: "DELETE /plugins/:pluginId" as RouteSignature,
      scopes: [SCOPES.CORE_WRITE],
    })(async (req, res) => {
      try {
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
    }),
  );

  // GET /plugins/:pluginId/status — runtime + definition health
  server.get(
    "/plugins/:pluginId/status",
    requireAdminOrApiToken({
      policySignature: "GET /plugins/:pluginId/status" as RouteSignature,
      scopes: [SCOPES.CORE_READ],
    })(async (req, res) => {
      const params = req.params as { pluginId?: string } | undefined;
      const pluginId = params?.pluginId;
      if (!pluginId) {
        res.status(400).json({ status: "error", code: "BAD_REQUEST" });
        return;
      }
      const plugin = await db.plugin.findUnique({
        where: { id: pluginId },
        include: {
          capabilities: {
            select: {
              id: true,
              kind: true,
              key: true,
              displayName: true,
              isEnabled: true,
            },
          },
        },
      });
      if (!plugin) {
        res.status(404).json({ status: "error", code: "NOT_FOUND" });
        return;
      }

      const [triggerDefs, actionDefs] = await Promise.all([
        db.triggerDefinition.findMany({
          where: { capability: { pluginId } },
          select: {
            id: true,
            name: true,
            isEnabled: true,
            createdAt: true,
            updatedAt: true,
          },
        }),
        db.actionDefinition.findMany({
          where: { capability: { pluginId } },
          select: {
            id: true,
            name: true,
            isEnabled: true,
            createdAt: true,
            updatedAt: true,
          },
        }),
      ]);

      const snapshot = runtime?.getPluginRuntimeSnapshot(pluginId) ?? {
        triggers: [],
        actions: [],
      };

      const triggerRuntimeMap = new Map(
        snapshot.triggers.map((entry) => [entry.definitionId, entry]),
      );
      const actionRuntimeMap = new Map(
        snapshot.actions.map((entry) => [entry.definitionId, entry]),
      );

      const triggers = triggerDefs.map((def) => {
        const runtimeEntry = triggerRuntimeMap.get(def.id);
        if (runtimeEntry) triggerRuntimeMap.delete(def.id);
        return {
          id: def.id,
          name: def.name,
          isEnabled: def.isEnabled,
          createdAt: toIso(def.createdAt),
          updatedAt: toIso(def.updatedAt),
          runtime: formatTriggerHealth(runtimeEntry),
        };
      });
      const actions = actionDefs.map((def) => {
        const runtimeEntry = actionRuntimeMap.get(def.id);
        if (runtimeEntry) actionRuntimeMap.delete(def.id);
        return {
          id: def.id,
          name: def.name,
          isEnabled: def.isEnabled,
          createdAt: toIso(def.createdAt),
          updatedAt: toIso(def.updatedAt),
          runtime: formatActionHealth(runtimeEntry),
        };
      });

      const runningTriggers = snapshot.triggers.filter((entry) => entry.isRunning).length;
      const lastTriggerActivityAt = snapshot.triggers.reduce<Date | undefined>((latest, entry) => {
        if (!entry.lastEmitAt) return latest;
        if (!latest || entry.lastEmitAt > latest) return entry.lastEmitAt;
        return latest;
      }, undefined);
      const lastActionActivityAt = snapshot.actions.reduce<Date | undefined>((latest, entry) => {
        if (!entry.lastInvocationAt) return latest;
        if (!latest || entry.lastInvocationAt > latest) return entry.lastInvocationAt;
        return latest;
      }, undefined);

      const orphanedTriggers = Array.from(triggerRuntimeMap.values())
        .map(formatTriggerHealth)
        .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));
      const orphanedActions = Array.from(actionRuntimeMap.values())
        .map(formatActionHealth)
        .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));

      res.status(200).json({
        plugin: {
          id: plugin.id,
          name: plugin.name,
          description: plugin.description,
          author: plugin.author,
          installedAt: toIso(plugin.installedAt as Date | string | null),
        },
        capabilities: plugin.capabilities,
        totals: {
          triggerDefinitions: triggerDefs.length,
          actionDefinitions: actionDefs.length,
          capabilityCount: plugin.capabilities.length,
          runtimeTriggerEntries: snapshot.triggers.length,
          runtimeActionEntries: snapshot.actions.length,
        },
        runtimeSummary: {
          runningTriggers,
          lastTriggerActivityAt: toIso(lastTriggerActivityAt),
          lastActionActivityAt: toIso(lastActionActivityAt),
        },
        definitions: {
          triggers,
          actions,
        },
        orphanedRuntime: {
          triggers: orphanedTriggers,
          actions: orphanedActions,
        },
      });
    }),
  );

  // GET /capabilities — consolidated list across plugins
  server.get(
    "/capabilities",
    requireAdminOrApiToken({
      policySignature: "GET /capabilities" as RouteSignature,
      scopes: [SCOPES.CORE_READ],
    })(async (req, res) => {
      try {
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
    }),
  );

  // GET /system/plugin-runtime/health — global runtime summary
  server.get(
    "/system/plugin-runtime/health",
    requireAdminOrApiToken({
      policySignature: "GET /system/plugin-runtime/health" as RouteSignature,
      scopes: [SCOPES.CORE_READ],
    })(async (_req, res) => {
      if (!runtime) {
        res.status(503).json({ status: "error", code: "RUNTIME_UNAVAILABLE" });
        return;
      }
      const summary = runtime.getRuntimeHealthSummary();
      res.status(200).json({
        generatedAt: summary.generatedAt.toISOString(),
        pluginCount: summary.pluginCount,
        triggerDefinitions: {
          total: summary.triggerDefinitions.total,
          running: summary.triggerDefinitions.running,
          totalEmitCount: summary.triggerDefinitions.totalEmitCount,
          errorCount: summary.triggerDefinitions.errorCount,
          lastActivityAt: toIso(summary.triggerDefinitions.lastActivityAt),
        },
        actionDefinitions: {
          total: summary.actionDefinitions.total,
          successCount: summary.actionDefinitions.successCount,
          retryCount: summary.actionDefinitions.retryCount,
          failureCount: summary.actionDefinitions.failureCount,
          skippedCount: summary.actionDefinitions.skippedCount,
          errorCount: summary.actionDefinitions.errorCount,
          lastInvocationAt: toIso(summary.actionDefinitions.lastInvocationAt),
        },
      });
    }),
  );
}
