import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { HttpServer } from "../../http/http-server.js";
import { getDb } from "../../db/db.js";
import { requireAdminOrApiToken } from "../../middleware/require-admin-or-api-token.js";
import { SCOPES } from "../../auth/scopes.js";
import type { RouteSignature } from "../../authz/policy.js";
import type { BundleRebuildScheduler } from "../../bundles/scheduler.js";
import { appendChangeLog, materializeVersion } from "../../history/changelog.js";
import type { AppConfig } from "../../config/env-config.js";
import type { Prisma, ChangeKind } from "@latchflow/db";

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

const STORAGE_PLACEHOLDER_PREFIX = "pending://bundle";

export function registerBundleAdminRoutes(
  server: HttpServer,
  deps?: { scheduler?: BundleRebuildScheduler; config?: AppConfig },
) {
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

  const actorContextForReq = (req: unknown) => {
    const user = (req as { user?: { id?: string } }).user;
    const actorId = user?.id ?? systemUserId;
    return { actorType: "USER" as const, actorUserId: actorId };
  };

  const toBundleDto = (b: {
    id: string;
    name: string;
    storagePath: string;
    checksum: string;
    description: string | null;
    isEnabled: boolean;
    createdAt: Date | string;
    updatedAt: Date | string;
  }) => ({
    id: b.id,
    name: b.name,
    storagePath: b.storagePath,
    checksum: b.checksum,
    description: b.description,
    isEnabled: b.isEnabled,
    createdAt: typeof b.createdAt === "string" ? b.createdAt : b.createdAt.toISOString(),
    updatedAt: typeof b.updatedAt === "string" ? b.updatedAt : b.updatedAt.toISOString(),
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

  const scheduleRebuild = (bundleId: string, opts?: { force?: boolean }) => {
    try {
      deps?.scheduler?.schedule(bundleId, opts);
    } catch {
      // Scheduler errors should not fail the request
    }
  };

  // GET /bundles — list bundles
  server.get(
    "/bundles",
    requireAdminOrApiToken({
      policySignature: "GET /bundles" as RouteSignature,
      scopes: [SCOPES.BUNDLES_READ],
    })(async (req, res) => {
      const Q = z.object({
        limit: z.coerce.number().int().min(1).max(200).optional(),
        cursor: z.string().optional(),
        q: z.string().optional(),
        isEnabled: z.coerce.boolean().optional(),
        updatedSince: z.coerce.date().optional(),
      });
      const parsed = Q.safeParse(req.query ?? {});
      const query = parsed.success ? parsed.data : {};
      const where: Prisma.BundleWhereInput = {};
      if (query.q) where.name = { contains: query.q, mode: "insensitive" };
      if (typeof query.isEnabled === "boolean") where.isEnabled = query.isEnabled;
      if (query.updatedSince) where.updatedAt = { gte: query.updatedSince };

      const take = query.limit ?? 50;
      const rows = await db.bundle.findMany({
        where,
        orderBy: { id: "desc" },
        take,
        ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      });
      const items = rows.map(toBundleDto);
      const nextCursor = rows.length === take ? rows[rows.length - 1]?.id : undefined;
      res.status(200).json({ items, ...(nextCursor ? { nextCursor } : {}) });
    }),
  );

  // POST /bundles — create bundle definition
  server.post(
    "/bundles",
    requireAdminOrApiToken({
      policySignature: "POST /bundles" as RouteSignature,
      scopes: [SCOPES.BUNDLES_WRITE],
    })(async (req, res) => {
      const Body = z.object({
        name: z.string().min(1),
        description: z.string().trim().max(10_000).nullish(),
      });
      const parsed = Body.safeParse(req.body ?? {});
      if (!parsed.success) {
        res.status(400).json({ status: "error", code: "BAD_REQUEST", message: "Invalid body" });
        return;
      }
      const actor = actorContextForReq(req);
      const placeholder = `${STORAGE_PLACEHOLDER_PREFIX}/${randomUUID()}`;
      const created = await db.bundle.create({
        data: {
          name: parsed.data.name,
          description: parsed.data.description ?? null,
          storagePath: placeholder,
          checksum: "",
          bundleDigest: "",
          createdBy: actor.actorUserId,
        },
      });
      await appendChangeLog(db, historyCfg, "BUNDLE", created.id, actor, {
        changeKind: "UPDATE_PARENT" as ChangeKind,
      });
      scheduleRebuild(created.id, { force: true });
      res.status(201).json(toBundleDto(created));
    }),
  );

  // GET /bundles/:bundleId — fetch bundle
  server.get(
    "/bundles/:bundleId",
    requireAdminOrApiToken({
      policySignature: "GET /bundles/:bundleId" as RouteSignature,
      scopes: [SCOPES.BUNDLES_READ],
    })(async (req, res) => {
      const params = (req.params ?? {}) as Record<string, string>;
      const bundleId = params.bundleId;
      if (!bundleId) {
        res.status(400).json({ status: "error", code: "BAD_REQUEST" });
        return;
      }
      const row = await db.bundle.findUnique({ where: { id: bundleId } });
      if (!row) {
        res.status(404).json({ status: "error", code: "NOT_FOUND" });
        return;
      }
      res.status(200).json(toBundleDto(row));
    }),
  );

  // PATCH /bundles/:bundleId — update metadata
  server.patch(
    "/bundles/:bundleId",
    requireAdminOrApiToken({
      policySignature: "PATCH /bundles/:bundleId" as RouteSignature,
      scopes: [SCOPES.BUNDLES_WRITE],
    })(async (req, res) => {
      const params = (req.params ?? {}) as Record<string, string>;
      const bundleId = params.bundleId;
      if (!bundleId) {
        res.status(400).json({ status: "error", code: "BAD_REQUEST" });
        return;
      }
      const Body = z.object({
        name: z.string().min(1).optional(),
        description: z.string().trim().max(10_000).nullable().optional(),
        isEnabled: z.boolean().optional(),
      });
      const parsed = Body.safeParse(req.body ?? {});
      if (
        !parsed.success ||
        (parsed.data.name === undefined &&
          parsed.data.description === undefined &&
          parsed.data.isEnabled === undefined)
      ) {
        res.status(400).json({ status: "error", code: "BAD_REQUEST" });
        return;
      }
      const actor = actorContextForReq(req);
      const patch: Prisma.BundleUncheckedUpdateInput = {
        ...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}),
        ...(parsed.data.description !== undefined ? { description: parsed.data.description } : {}),
        ...(parsed.data.isEnabled !== undefined ? { isEnabled: parsed.data.isEnabled } : {}),
        updatedBy: actor.actorUserId,
      };
      const updated = await db.bundle
        .update({ where: { id: bundleId }, data: patch })
        .catch(() => null);
      if (!updated) {
        res.status(404).json({ status: "error", code: "NOT_FOUND" });
        return;
      }
      await appendChangeLog(db, historyCfg, "BUNDLE", bundleId, actor, {
        changeKind: "UPDATE_PARENT" as ChangeKind,
      });
      res.sendStatus(204);
    }),
  );

  // DELETE /bundles/:bundleId — delete when unused
  server.delete(
    "/bundles/:bundleId",
    requireAdminOrApiToken({
      policySignature: "DELETE /bundles/:bundleId" as RouteSignature,
      scopes: [SCOPES.BUNDLES_WRITE],
    })(async (req, res) => {
      const params = (req.params ?? {}) as Record<string, string>;
      const bundleId = params.bundleId;
      if (!bundleId) {
        res.status(400).json({ status: "error", code: "BAD_REQUEST" });
        return;
      }
      const [objectCount, assignmentCount, downloadCount] = await Promise.all([
        db.bundleObject.count({ where: { bundleId } }),
        db.bundleAssignment.count({ where: { bundleId } }),
        db.downloadEvent.count({ where: { bundleAssignment: { bundleId } } }),
      ]);
      if (objectCount > 0 || assignmentCount > 0 || downloadCount > 0) {
        res.status(409).json({ status: "error", code: "IN_USE" });
        return;
      }
      const deleted = await db.bundle
        .delete({ where: { id: bundleId } })
        .then(() => true)
        .catch(() => false);
      if (!deleted) {
        res.status(404).json({ status: "error", code: "NOT_FOUND" });
        return;
      }
      res.sendStatus(204);
    }),
  );

  // GET /bundles/:bundleId/versions — list changelog entries
  server.get(
    "/bundles/:bundleId/versions",
    requireAdminOrApiToken({
      policySignature: "GET /bundles/:bundleId/versions" as RouteSignature,
      scopes: [SCOPES.BUNDLES_READ],
    })(async (req, res) => {
      const params = (req.params ?? {}) as Record<string, string>;
      const bundleId = params.bundleId;
      if (!bundleId) {
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
        where: { entityType: "BUNDLE", entityId: bundleId },
        orderBy: { version: "desc" },
        take,
        ...(query.cursor
          ? {
              cursor: {
                entityType_entityId_version: {
                  entityType: "BUNDLE",
                  entityId: bundleId,
                  version: query.cursor,
                },
              },
              skip: 1,
            }
          : {}),
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
      res.status(200).json({ items, ...(nextCursor ? { nextCursor } : {}) });
    }),
  );

  // GET /bundles/:bundleId/versions/:version — materialized state
  server.get(
    "/bundles/:bundleId/versions/:version",
    requireAdminOrApiToken({
      policySignature: "GET /bundles/:bundleId/versions/:version" as RouteSignature,
      scopes: [SCOPES.BUNDLES_READ],
    })(async (req, res) => {
      const params = (req.params ?? {}) as Record<string, string>;
      const bundleId = params.bundleId;
      const versionNum = params.version ? Number(params.version) : NaN;
      if (!bundleId || Number.isNaN(versionNum) || versionNum < 1) {
        res.status(400).json({ status: "error", code: "BAD_REQUEST" });
        return;
      }
      const row = await db.changeLog.findUnique({
        where: {
          entityType_entityId_version: {
            entityType: "BUNDLE",
            entityId: bundleId,
            version: versionNum,
          },
        },
      });
      if (!row) {
        res.status(404).json({ status: "error", code: "NOT_FOUND" });
        return;
      }
      const state = await materializeVersion(db, "BUNDLE", bundleId, versionNum);
      if (!state) {
        res.status(404).json({ status: "error", code: "NOT_FOUND" });
        return;
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
}
