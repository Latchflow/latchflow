import { z } from "zod";
import type { HttpServer } from "../../http/http-server.js";
import { getDb } from "../../db/db.js";
import { requireAdminOrApiToken } from "../../middleware/require-admin-or-api-token.js";
import { SCOPES } from "../../auth/scopes.js";
import type { RouteSignature } from "../../authz/policy.js";
import type { Prisma, ChangeKind } from "@latchflow/db";
import type { AppConfig } from "../../config/env-config.js";
import { appendChangeLog, materializeVersion } from "../../history/changelog.js";

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

export function registerRecipientAdminRoutes(server: HttpServer, config: AppConfig) {
  const db = getDb();

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

  const toRecipientDto = (r: {
    id: string;
    email: string;
    name: string | null;
    isEnabled: boolean;
    createdAt: Date | string;
    updatedAt: Date | string;
  }) => ({
    id: r.id,
    email: r.email,
    name: r.name,
    isEnabled: r.isEnabled,
    createdAt: typeof r.createdAt === "string" ? r.createdAt : r.createdAt.toISOString(),
    updatedAt: typeof r.updatedAt === "string" ? r.updatedAt : r.updatedAt.toISOString(),
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

  const requireRecipientExists = async (id: string) => {
    const row = await db.recipient.findUnique({ where: { id } });
    if (!row) return null;
    return row;
  };

  // GET /recipients — list recipients
  server.get(
    "/recipients",
    requireAdminOrApiToken({
      policySignature: "GET /recipients" as RouteSignature,
      scopes: [SCOPES.RECIPIENTS_READ],
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
      const where: Prisma.RecipientWhereInput = {};
      if (query.q) {
        where.OR = [
          { email: { contains: query.q, mode: "insensitive" } },
          { name: { contains: query.q, mode: "insensitive" } },
        ];
      }
      if (typeof query.isEnabled === "boolean") where.isEnabled = query.isEnabled;
      if (query.updatedSince) where.updatedAt = { gte: query.updatedSince };

      const take = query.limit ?? 50;
      const rows = await db.recipient.findMany({
        where,
        orderBy: { id: "desc" },
        take,
        ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      });
      const items = rows.map(toRecipientDto);
      const nextCursor = rows.length === take ? rows[rows.length - 1]?.id : undefined;
      res.status(200).json({ items, ...(nextCursor ? { nextCursor } : {}) });
    }),
  );

  // POST /recipients — create
  server.post(
    "/recipients",
    requireAdminOrApiToken({
      policySignature: "POST /recipients" as RouteSignature,
      scopes: [SCOPES.RECIPIENTS_WRITE],
    })(async (req, res) => {
      const Body = z.object({
        email: z.string().email(),
        name: z.string().trim().max(200).nullish(),
        isEnabled: z.boolean().optional(),
      });
      const parsed = Body.safeParse(req.body ?? {});
      if (!parsed.success) {
        res.status(400).json({ status: "error", code: "BAD_REQUEST", message: "Invalid body" });
        return;
      }
      const actor = actorContextForReq(req);
      try {
        const created = await db.recipient.create({
          data: {
            email: parsed.data.email.toLowerCase(),
            name: parsed.data.name ?? null,
            isEnabled: parsed.data.isEnabled ?? true,
            createdBy: actor.actorUserId,
          },
        });
        await appendChangeLog(db, historyCfg, "RECIPIENT", created.id, actor, {
          changeKind: "UPDATE_PARENT" as ChangeKind,
        });
        res.status(201).json(toRecipientDto(created));
      } catch (err) {
        if ((err as { code?: string }).code === "P2002") {
          res.status(409).json({ status: "error", code: "EMAIL_EXISTS" });
          return;
        }
        throw err;
      }
    }),
  );

  // GET /recipients/:recipientId — fetch recipient
  server.get(
    "/recipients/:recipientId",
    requireAdminOrApiToken({
      policySignature: "GET /recipients/:recipientId" as RouteSignature,
      scopes: [SCOPES.RECIPIENTS_READ],
    })(async (req, res) => {
      const id = (req.params as Record<string, string> | undefined)?.recipientId;
      if (!id) {
        res.status(400).json({ status: "error", code: "BAD_REQUEST" });
        return;
      }
      const row = await db.recipient.findUnique({ where: { id } });
      if (!row) {
        res.status(404).json({ status: "error", code: "NOT_FOUND" });
        return;
      }
      res.status(200).json(toRecipientDto(row));
    }),
  );

  // PATCH /recipients/:recipientId — update metadata
  server.patch(
    "/recipients/:recipientId",
    requireAdminOrApiToken({
      policySignature: "PATCH /recipients/:recipientId" as RouteSignature,
      scopes: [SCOPES.RECIPIENTS_WRITE],
    })(async (req, res) => {
      const id = (req.params as Record<string, string> | undefined)?.recipientId;
      if (!id) {
        res.status(400).json({ status: "error", code: "BAD_REQUEST" });
        return;
      }
      const Body = z.object({
        name: z.string().trim().max(200).nullable().optional(),
        isEnabled: z.boolean().optional(),
      });
      const parsed = Body.safeParse(req.body ?? {});
      if (
        !parsed.success ||
        (parsed.data.name === undefined && parsed.data.isEnabled === undefined)
      ) {
        res.status(400).json({ status: "error", code: "BAD_REQUEST" });
        return;
      }
      const actor = actorContextForReq(req);
      const patch: Prisma.RecipientUncheckedUpdateInput = {
        ...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}),
        ...(parsed.data.isEnabled !== undefined ? { isEnabled: parsed.data.isEnabled } : {}),
        updatedBy: actor.actorUserId,
      };
      const updated = await db.recipient.update({ where: { id }, data: patch }).catch(() => null);
      if (!updated) {
        res.status(404).json({ status: "error", code: "NOT_FOUND" });
        return;
      }
      await appendChangeLog(db, historyCfg, "RECIPIENT", id, actor, {
        changeKind: "UPDATE_PARENT" as ChangeKind,
      });
      res.sendStatus(204);
    }),
  );

  // DELETE /recipients/:recipientId — disable when safe
  server.delete(
    "/recipients/:recipientId",
    requireAdminOrApiToken({
      policySignature: "DELETE /recipients/:recipientId" as RouteSignature,
      scopes: [SCOPES.RECIPIENTS_WRITE],
    })(async (req, res) => {
      const id = (req.params as Record<string, string> | undefined)?.recipientId;
      if (!id) {
        res.status(400).json({ status: "error", code: "BAD_REQUEST" });
        return;
      }
      const assignments = await db.bundleAssignment.count({ where: { recipientId: id } });
      if (assignments > 0) {
        res.status(409).json({ status: "error", code: "IN_USE" });
        return;
      }
      const deleted = await db.recipient
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

  // GET /recipients/:recipientId/versions — list change log
  server.get(
    "/recipients/:recipientId/versions",
    requireAdminOrApiToken({
      policySignature: "GET /recipients/:recipientId/versions" as RouteSignature,
      scopes: [SCOPES.RECIPIENTS_READ],
    })(async (req, res) => {
      const id = (req.params as Record<string, string> | undefined)?.recipientId;
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
        where: { entityType: "RECIPIENT", entityId: id },
        orderBy: { version: "desc" },
        take,
        ...(query.cursor
          ? {
              cursor: {
                entityType_entityId_version: {
                  entityType: "RECIPIENT",
                  entityId: id,
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

  // GET /recipients/:recipientId/versions/:version — materialized state
  server.get(
    "/recipients/:recipientId/versions/:version",
    requireAdminOrApiToken({
      policySignature: "GET /recipients/:recipientId/versions/:version" as RouteSignature,
      scopes: [SCOPES.RECIPIENTS_READ],
    })(async (req, res) => {
      const params = req.params as Record<string, string> | undefined;
      const id = params?.recipientId;
      const versionNum = params?.version ? Number(params.version) : NaN;
      if (!id || Number.isNaN(versionNum) || versionNum < 1) {
        res.status(400).json({ status: "error", code: "BAD_REQUEST" });
        return;
      }
      const row = await db.changeLog.findUnique({
        where: {
          entityType_entityId_version: {
            entityType: "RECIPIENT",
            entityId: id,
            version: versionNum,
          },
        },
      });
      if (!row) {
        res.status(404).json({ status: "error", code: "NOT_FOUND" });
        return;
      }
      const state = await materializeVersion(db, "RECIPIENT", id, versionNum);
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

  // GET /bundles/:bundleId/recipients — list bundle assignments
  server.get(
    "/bundles/:bundleId/recipients",
    requireAdminOrApiToken({
      policySignature: "GET /bundles/:bundleId/recipients" as RouteSignature,
      scopes: [SCOPES.BUNDLES_READ],
    })(async (req, res) => {
      const bundleId = (req.params as Record<string, string> | undefined)?.bundleId;
      if (!bundleId) {
        res.status(400).json({ status: "error", code: "BAD_REQUEST" });
        return;
      }
      const Q = z.object({
        limit: z.coerce.number().int().min(1).max(200).optional(),
        cursor: z.string().optional(),
      });
      const parsed = Q.safeParse(req.query ?? {});
      const query = parsed.success ? parsed.data : {};
      const take = query.limit ?? 50;
      const rows = await db.bundleAssignment.findMany({
        where: { bundleId },
        select: {
          bundleId: true,
          recipient: true,
          createdAt: true,
          updatedAt: true,
        },
        orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
        take,
        ...(query.cursor
          ? {
              cursor: { id: query.cursor },
              skip: 1,
            }
          : {}),
      });
      const items = rows
        .map((row) => row.recipient)
        .filter((r): r is NonNullable<typeof r> => Boolean(r))
        .map((r) => toRecipientDto(r));
      const nextCursor = rows.length === take ? rows[rows.length - 1]?.recipient?.id : undefined;
      res.status(200).json({ items, ...(nextCursor ? { nextCursor } : {}) });
    }),
  );

  // POST /bundles/:bundleId/recipients — attach single recipient
  server.post(
    "/bundles/:bundleId/recipients",
    requireAdminOrApiToken({
      policySignature: "POST /bundles/:bundleId/recipients" as RouteSignature,
      scopes: [SCOPES.BUNDLES_WRITE],
    })(async (req, res) => {
      const bundleId = (req.params as Record<string, string> | undefined)?.bundleId;
      if (!bundleId) {
        res.status(400).json({ status: "error", code: "BAD_REQUEST" });
        return;
      }
      const Body = z.object({ recipientId: z.string().uuid() });
      const parsed = Body.safeParse(req.body ?? {});
      if (!parsed.success) {
        res.status(400).json({ status: "error", code: "BAD_REQUEST" });
        return;
      }
      const { recipientId } = parsed.data;
      const actor = actorContextForReq(req);
      const recipient = await requireRecipientExists(recipientId);
      if (!recipient) {
        res.status(404).json({ status: "error", code: "RECIPIENT_NOT_FOUND" });
        return;
      }
      const existing = await db.bundleAssignment.findUnique({
        where: { bundleId_recipientId: { bundleId, recipientId } },
      });
      if (existing) {
        res.status(409).json({ status: "error", code: "ALREADY_ASSIGNED" });
        return;
      }
      await db.bundleAssignment.create({
        data: {
          bundleId,
          recipientId,
          createdBy: actor.actorUserId,
        },
      });
      await appendChangeLog(db, historyCfg, "BUNDLE", bundleId, actor, {
        changeKind: "UPDATE_CHILD" as ChangeKind,
        changedPath: "/assignments",
      });
      res.sendStatus(204);
    }),
  );

  // POST /bundles/:bundleId/recipients/batch — attach many
  server.post(
    "/bundles/:bundleId/recipients/batch",
    requireAdminOrApiToken({
      policySignature: "POST /bundles/:bundleId/recipients/batch" as RouteSignature,
      scopes: [SCOPES.BUNDLES_WRITE],
    })(async (req, res) => {
      const bundleId = (req.params as Record<string, string> | undefined)?.bundleId;
      if (!bundleId) {
        res.status(400).json({ status: "error", code: "BAD_REQUEST" });
        return;
      }
      const Body = z.object({
        recipientIds: z.array(z.string().uuid()).min(1),
      });
      const parsed = Body.safeParse(req.body ?? {});
      if (!parsed.success) {
        res.status(400).json({ status: "error", code: "BAD_REQUEST" });
        return;
      }
      const recipientIds = Array.from(new Set(parsed.data.recipientIds));
      const actor = actorContextForReq(req);
      const existingAssignments = await db.bundleAssignment.findMany({
        where: { bundleId, recipientId: { in: recipientIds } },
        select: { recipientId: true },
      });
      const already = new Set(existingAssignments.map((a) => a.recipientId));
      const attachIds = recipientIds.filter((rid) => !already.has(rid));
      if (attachIds.length === 0) {
        res.sendStatus(204);
        return;
      }
      const recipients = await db.recipient.findMany({
        where: { id: { in: attachIds } },
        select: { id: true },
      });
      if (recipients.length !== attachIds.length) {
        res.status(404).json({ status: "error", code: "RECIPIENT_NOT_FOUND" });
        return;
      }
      const createdBy = actor.actorUserId;
      await db.bundleAssignment.createMany({
        data: attachIds.map((recipientId) => ({ bundleId, recipientId, createdBy })),
        skipDuplicates: true,
      });
      await appendChangeLog(db, historyCfg, "BUNDLE", bundleId, actor, {
        changeKind: "ADD_CHILD" as ChangeKind,
        changedPath: "/assignments",
      });
      res.sendStatus(204);
    }),
  );

  // DELETE /bundles/:bundleId/recipients — detach
  server.delete(
    "/bundles/:bundleId/recipients",
    requireAdminOrApiToken({
      policySignature: "DELETE /bundles/:bundleId/recipients" as RouteSignature,
      scopes: [SCOPES.BUNDLES_WRITE],
    })(async (req, res) => {
      const bundleId = (req.params as Record<string, string> | undefined)?.bundleId;
      const recipientId = (req.query as Record<string, string> | undefined)?.recipientId;
      if (!bundleId || !recipientId) {
        res.status(400).json({ status: "error", code: "BAD_REQUEST" });
        return;
      }
      const actor = actorContextForReq(req);
      const assignment = await db.bundleAssignment.findUnique({
        where: { bundleId_recipientId: { bundleId, recipientId } },
      });
      if (!assignment) {
        res.status(404).json({ status: "error", code: "NOT_FOUND" });
        return;
      }
      const downloadCount = await db.downloadEvent.count({
        where: { bundleAssignmentId: assignment.id },
      });
      if (downloadCount > 0) {
        res.status(409).json({ status: "error", code: "DOWNLOAD_HISTORY_EXISTS" });
        return;
      }
      await db.bundleAssignment.delete({
        where: { bundleId_recipientId: { bundleId, recipientId } },
      });
      await appendChangeLog(db, historyCfg, "BUNDLE", bundleId, actor, {
        changeKind: "REMOVE_CHILD" as ChangeKind,
        changedPath: "/assignments",
      });
      res.sendStatus(204);
    }),
  );
}
