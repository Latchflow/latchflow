import { z } from "zod";
import type { HttpServer } from "../../http/http-server.js";
import { getDb } from "../../db/db.js";
import type { Prisma, ChangeKind } from "@latchflow/db";
import { requireAdminOrApiToken } from "../../middleware/require-admin-or-api-token.js";
import { SCOPES } from "../../auth/scopes.js";
import type { RouteSignature } from "../../authz/policy.js";
import type { AppConfig } from "../../config/config.js";
import { appendChangeLog, materializeVersion } from "../../history/changelog.js";

export function registerPipelineAdminRoutes(server: HttpServer, deps?: { config?: AppConfig }) {
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

  const actorContextForReq = (req: unknown) => {
    const user = (req as { user?: { id?: string } }).user;
    const actorId = user?.id ?? systemUserId;
    return { actorType: "USER" as const, actorUserId: actorId };
  };

  const toPipelineListDto = (p: {
    id: string;
    name: string;
    description: string | null;
    isEnabled: boolean;
    createdAt: Date | string;
    updatedAt: Date | string;
  }) => ({
    id: p.id,
    name: p.name,
    description: p.description,
    isEnabled: p.isEnabled,
    createdAt: typeof p.createdAt === "string" ? p.createdAt : p.createdAt.toISOString(),
    updatedAt: typeof p.updatedAt === "string" ? p.updatedAt : p.updatedAt.toISOString(),
  });

  const toPipelineDetailDto = (p: {
    id: string;
    name: string;
    description: string | null;
    isEnabled: boolean;
    createdAt: Date;
    updatedAt: Date;
    createdBy: string;
    updatedBy: string | null;
    steps: Array<{ id: string; actionId: string; sortOrder: number; isEnabled: boolean }>;
    triggers: Array<{ triggerId: string; sortOrder: number; isEnabled: boolean }>;
  }) => ({
    id: p.id,
    name: p.name,
    description: p.description,
    isEnabled: p.isEnabled,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
    createdBy: p.createdBy,
    updatedBy: p.updatedBy ?? null,
    steps: [...p.steps]
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((s) => ({
        id: s.id,
        actionId: s.actionId,
        sortOrder: s.sortOrder,
        isEnabled: s.isEnabled,
      })),
    triggers: [...p.triggers]
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((t) => ({ triggerId: t.triggerId, sortOrder: t.sortOrder, isEnabled: t.isEnabled })),
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

  async function resequenceSteps(
    tx: Prisma.TransactionClient,
    pipelineId: string,
    actorUserId?: string,
  ) {
    const steps = await tx.pipelineStep.findMany({
      where: { pipelineId },
      orderBy: { sortOrder: "asc" },
      select: { id: true, sortOrder: true },
    });
    let desired = 1;
    for (const step of steps) {
      if (step.sortOrder !== desired) {
        await tx.pipelineStep.update({
          where: { id: step.id },
          data: {
            sortOrder: desired,
            ...(actorUserId ? { updatedBy: actorUserId } : {}),
          },
        });
      }
      desired += 1;
    }
  }

  async function resequenceTriggers(
    tx: Prisma.TransactionClient,
    pipelineId: string,
    actorUserId?: string,
  ) {
    const triggers = await tx.pipelineTrigger.findMany({
      where: { pipelineId },
      orderBy: { sortOrder: "asc" },
      select: { triggerId: true, sortOrder: true },
    });
    let desired = 1;
    for (const trig of triggers) {
      if (trig.sortOrder !== desired) {
        await tx.pipelineTrigger.update({
          where: { pipelineId_triggerId: { pipelineId, triggerId: trig.triggerId } },
          data: {
            sortOrder: desired,
            ...(actorUserId ? { updatedBy: actorUserId } : {}),
          },
        });
      }
      desired += 1;
    }
  }

  // GET /pipelines — list
  server.get(
    "/pipelines",
    requireAdminOrApiToken({
      policySignature: "GET /pipelines" as RouteSignature,
      scopes: [SCOPES.PIPELINES_READ],
    })(async (req, res) => {
      const Q = z.object({
        limit: z.coerce.number().int().min(1).max(200).optional(),
        cursor: z.string().optional(),
        q: z.string().optional(),
        enabled: z.coerce.boolean().optional(),
        updatedSince: z.coerce.date().optional(),
      });
      const parsed = Q.safeParse(req.query ?? {});
      const query = parsed.success ? parsed.data : {};
      const where: Prisma.PipelineWhereInput = {};
      if (query.q) where.name = { contains: query.q, mode: "insensitive" };
      if (typeof query.enabled === "boolean") where.isEnabled = query.enabled;
      if (query.updatedSince) where.updatedAt = { gte: query.updatedSince };
      const take = query.limit ?? 50;
      const rows = await db.pipeline.findMany({
        where,
        orderBy: { id: "desc" },
        take,
        ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      });
      const items = rows.map(toPipelineListDto);
      const nextCursor = rows.length === take ? rows[rows.length - 1]?.id : undefined;
      res.status(200).json({ items, nextCursor });
    }),
  );

  // POST /pipelines — create
  server.post(
    "/pipelines",
    requireAdminOrApiToken({
      policySignature: "POST /pipelines" as RouteSignature,
      scopes: [SCOPES.PIPELINES_WRITE],
    })(async (req, res) => {
      const Body = z.object({
        name: z.string().min(1),
        description: z.string().trim().max(10_000).nullish(),
        isEnabled: z.boolean().optional(),
      });
      const parsed = Body.safeParse(req.body ?? {});
      if (!parsed.success) {
        res.status(400).json({ status: "error", code: "BAD_REQUEST" });
        return;
      }
      const actor = actorContextForReq(req);
      const created = await db.pipeline.create({
        data: {
          name: parsed.data.name,
          description: parsed.data.description ?? null,
          isEnabled: parsed.data.isEnabled ?? true,
          createdBy: actor.actorUserId,
        },
      });
      await appendChangeLog(db, historyCfg, "PIPELINE", created.id, actor, {
        changeKind: "UPDATE_PARENT" as ChangeKind,
      });
      res.status(201).json(toPipelineListDto(created));
    }),
  );

  // GET /pipelines/:id — fetch single pipeline with steps/triggers
  server.get(
    "/pipelines/:id",
    requireAdminOrApiToken({
      policySignature: "GET /pipelines/:id" as RouteSignature,
      scopes: [SCOPES.PIPELINES_READ],
    })(async (req, res) => {
      const id = (req.params as Record<string, string> | undefined)?.id;
      if (!id) {
        res.status(400).json({ status: "error", code: "BAD_REQUEST" });
        return;
      }
      const row = await db.pipeline.findUnique({
        where: { id },
        include: {
          steps: { select: { id: true, actionId: true, sortOrder: true, isEnabled: true } },
          triggers: { select: { triggerId: true, sortOrder: true, isEnabled: true } },
        },
      });
      if (!row) {
        res.status(404).json({ status: "error", code: "NOT_FOUND" });
        return;
      }
      res.status(200).json(toPipelineDetailDto(row));
    }),
  );

  // PATCH /pipelines/:id — update metadata
  server.patch(
    "/pipelines/:id",
    requireAdminOrApiToken({
      policySignature: "PATCH /pipelines/:id" as RouteSignature,
      scopes: [SCOPES.PIPELINES_WRITE],
    })(async (req, res) => {
      const id = (req.params as Record<string, string> | undefined)?.id;
      if (!id) {
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
      const patch: Prisma.PipelineUncheckedUpdateInput = {
        ...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}),
        ...(parsed.data.description !== undefined ? { description: parsed.data.description } : {}),
        ...(parsed.data.isEnabled !== undefined ? { isEnabled: parsed.data.isEnabled } : {}),
        updatedBy: actor.actorUserId,
      };
      const updated = await db.pipeline.update({ where: { id }, data: patch }).catch(() => null);
      if (!updated) {
        res.status(404).json({ status: "error", code: "NOT_FOUND" });
        return;
      }
      await appendChangeLog(db, historyCfg, "PIPELINE", id, actor, {
        changeKind: "UPDATE_PARENT" as ChangeKind,
      });
      res.sendStatus(204);
    }),
  );

  // DELETE /pipelines/:id — delete when unused
  server.delete(
    "/pipelines/:id",
    requireAdminOrApiToken({
      policySignature: "DELETE /pipelines/:id" as RouteSignature,
      scopes: [SCOPES.PIPELINES_WRITE],
    })(async (req, res) => {
      const id = (req.params as Record<string, string> | undefined)?.id;
      if (!id) {
        res.status(400).json({ status: "error", code: "BAD_REQUEST" });
        return;
      }
      const [stepCount, triggerCount, runCount] = await Promise.all([
        db.pipelineStep.count({ where: { pipelineId: id } }),
        db.pipelineTrigger.count({ where: { pipelineId: id } }),
        db.pipelineRun.count({ where: { pipelineId: id } }),
      ]);
      if (stepCount > 0 || triggerCount > 0 || runCount > 0) {
        res.status(409).json({ status: "error", code: "IN_USE" });
        return;
      }
      const deleted = await db.pipeline
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

  // POST /pipelines/:id/steps — create step
  server.post(
    "/pipelines/:id/steps",
    requireAdminOrApiToken({
      policySignature: "POST /pipelines/:id/steps" as RouteSignature,
      scopes: [SCOPES.PIPELINES_WRITE],
    })(async (req, res) => {
      const params = req.params as Record<string, string> | undefined;
      const pipelineId = params?.id;
      if (!pipelineId) {
        res.status(400).json({ status: "error", code: "BAD_REQUEST" });
        return;
      }
      const pipeline = await db.pipeline.findUnique({
        where: { id: pipelineId },
        select: { id: true },
      });
      if (!pipeline) {
        res.status(404).json({ status: "error", code: "NOT_FOUND" });
        return;
      }
      const Body = z.object({
        actionId: z.string().min(1),
        sortOrder: z.coerce.number().int().min(1).optional(),
        isEnabled: z.boolean().optional(),
      });
      const parsed = Body.safeParse(req.body ?? {});
      if (!parsed.success) {
        res.status(400).json({ status: "error", code: "BAD_REQUEST" });
        return;
      }
      const action = await db.actionDefinition.findUnique({ where: { id: parsed.data.actionId } });
      if (!action || action.isEnabled === false) {
        res.status(400).json({ status: "error", code: "INVALID_ACTION" });
        return;
      }
      const actor = actorContextForReq(req);
      const result = await db.$transaction(async (tx) => {
        const existing = await tx.pipelineStep.findMany({
          where: { pipelineId },
          orderBy: { sortOrder: "asc" },
          select: { id: true, sortOrder: true },
        });
        const desiredOrderRaw = parsed.data.sortOrder ?? existing.length + 1;
        const desiredOrder = Math.min(Math.max(desiredOrderRaw, 1), existing.length + 1);
        if (parsed.data.sortOrder !== undefined) {
          for (const s of existing.filter((step) => step.sortOrder >= desiredOrder)) {
            await tx.pipelineStep.update({
              where: { id: s.id },
              data: { sortOrder: s.sortOrder + 1, updatedBy: actor.actorUserId },
            });
          }
        }
        const created = await tx.pipelineStep.create({
          data: {
            pipelineId,
            actionId: parsed.data.actionId,
            sortOrder: parsed.data.sortOrder !== undefined ? desiredOrder : existing.length + 1,
            isEnabled: parsed.data.isEnabled ?? true,
            createdBy: actor.actorUserId,
          },
        });
        await tx.pipeline.update({
          where: { id: pipelineId },
          data: { updatedBy: actor.actorUserId },
        });
        await appendChangeLog(tx, historyCfg, "PIPELINE", pipelineId, actor, {
          changeKind: "ADD_CHILD" as ChangeKind,
          changedPath: "/steps",
        });
        await resequenceSteps(tx, pipelineId, actor.actorUserId);
        return created;
      });
      res.status(201).json({
        id: result.id,
        actionId: result.actionId,
        sortOrder: result.sortOrder,
        isEnabled: result.isEnabled,
      });
    }),
  );

  // PATCH /pipelines/:id/steps/:stepId — update
  server.patch(
    "/pipelines/:id/steps/:stepId",
    requireAdminOrApiToken({
      policySignature: "PATCH /pipelines/:id/steps/:stepId" as RouteSignature,
      scopes: [SCOPES.PIPELINES_WRITE],
    })(async (req, res) => {
      const params = req.params as Record<string, string> | undefined;
      const pipelineId = params?.id;
      const stepId = params?.stepId;
      if (!pipelineId || !stepId) {
        res.status(400).json({ status: "error", code: "BAD_REQUEST" });
        return;
      }
      const Body = z.object({
        actionId: z.string().min(1).optional(),
        isEnabled: z.boolean().optional(),
        sortOrder: z.coerce.number().int().min(1).optional(),
      });
      const parsed = Body.safeParse(req.body ?? {});
      if (
        !parsed.success ||
        (parsed.data.actionId === undefined &&
          parsed.data.isEnabled === undefined &&
          parsed.data.sortOrder === undefined)
      ) {
        res.status(400).json({ status: "error", code: "BAD_REQUEST" });
        return;
      }
      const existingStep = await db.pipelineStep.findUnique({
        where: { id: stepId },
        select: { id: true, pipelineId: true, sortOrder: true },
      });
      if (!existingStep || existingStep.pipelineId !== pipelineId) {
        res.status(404).json({ status: "error", code: "NOT_FOUND" });
        return;
      }
      if (parsed.data.actionId) {
        const action = await db.actionDefinition.findUnique({
          where: { id: parsed.data.actionId },
        });
        if (!action || action.isEnabled === false) {
          res.status(400).json({ status: "error", code: "INVALID_ACTION" });
          return;
        }
      }
      const actor = actorContextForReq(req);
      await db.$transaction(async (tx) => {
        if (parsed.data.sortOrder !== undefined) {
          const steps = await tx.pipelineStep.findMany({
            where: { pipelineId },
            orderBy: { sortOrder: "asc" },
            select: { id: true, sortOrder: true },
          });
          const desired = Math.min(Math.max(parsed.data.sortOrder, 1), steps.length);
          for (const step of steps) {
            if (step.id === stepId) continue;
            let newOrder = step.sortOrder;
            if (step.sortOrder >= desired && existingStep.sortOrder < desired) {
              newOrder = step.sortOrder - 1;
            } else if (step.sortOrder <= desired && existingStep.sortOrder > desired) {
              newOrder = step.sortOrder + 1;
            }
            if (newOrder !== step.sortOrder) {
              await tx.pipelineStep.update({
                where: { id: step.id },
                data: { sortOrder: newOrder },
              });
            }
          }
          await tx.pipelineStep.update({
            where: { id: stepId },
            data: { sortOrder: desired, updatedBy: actor.actorUserId },
          });
        }
        const updateData: Prisma.PipelineStepUncheckedUpdateInput = {
          ...(parsed.data.actionId ? { actionId: parsed.data.actionId } : {}),
          ...(parsed.data.isEnabled !== undefined ? { isEnabled: parsed.data.isEnabled } : {}),
          updatedBy: actor.actorUserId,
        };
        if (parsed.data.actionId || parsed.data.isEnabled !== undefined) {
          await tx.pipelineStep.update({ where: { id: stepId }, data: updateData });
        }
        await tx.pipeline.update({
          where: { id: pipelineId },
          data: { updatedBy: actor.actorUserId },
        });
        await appendChangeLog(tx, historyCfg, "PIPELINE", pipelineId, actor, {
          changeKind:
            parsed.data.sortOrder !== undefined
              ? ("REORDER" as ChangeKind)
              : ("UPDATE_CHILD" as ChangeKind),
          changedPath: "/steps",
        });
        await resequenceSteps(tx, pipelineId, actor.actorUserId);
      });
      res.sendStatus(204);
    }),
  );

  // DELETE /pipelines/:id/steps/:stepId
  server.delete(
    "/pipelines/:id/steps/:stepId",
    requireAdminOrApiToken({
      policySignature: "DELETE /pipelines/:id/steps/:stepId" as RouteSignature,
      scopes: [SCOPES.PIPELINES_WRITE],
    })(async (req, res) => {
      const params = req.params as Record<string, string> | undefined;
      const pipelineId = params?.id;
      const stepId = params?.stepId;
      if (!pipelineId || !stepId) {
        res.status(400).json({ status: "error", code: "BAD_REQUEST" });
        return;
      }
      const step = await db.pipelineStep.findUnique({ where: { id: stepId } });
      if (!step || step.pipelineId !== pipelineId) {
        res.status(404).json({ status: "error", code: "NOT_FOUND" });
        return;
      }
      const actor = actorContextForReq(req);
      await db.$transaction(async (tx) => {
        await tx.pipelineStep.delete({ where: { id: stepId } });
        await resequenceSteps(tx, pipelineId, actor.actorUserId);
        await tx.pipeline.update({
          where: { id: pipelineId },
          data: { updatedBy: actor.actorUserId },
        });
        await appendChangeLog(tx, historyCfg, "PIPELINE", pipelineId, actor, {
          changeKind: "REMOVE_CHILD" as ChangeKind,
          changedPath: "/steps",
        });
      });
      res.sendStatus(204);
    }),
  );

  // POST /pipelines/:id/steps/reorder
  server.post(
    "/pipelines/:id/steps/reorder",
    requireAdminOrApiToken({
      policySignature: "POST /pipelines/:id/steps/reorder" as RouteSignature,
      scopes: [SCOPES.PIPELINES_WRITE],
    })(async (req, res) => {
      const pipelineId = (req.params as Record<string, string> | undefined)?.id;
      if (!pipelineId) {
        res.status(400).json({ status: "error", code: "BAD_REQUEST" });
        return;
      }
      const Body = z.object({
        order: z.array(z.string().min(1)).min(1),
      });
      const parsed = Body.safeParse(req.body ?? {});
      if (!parsed.success) {
        res.status(400).json({ status: "error", code: "BAD_REQUEST" });
        return;
      }
      const steps = await db.pipelineStep.findMany({
        where: { pipelineId },
        select: { id: true },
      });
      if (!steps.length) {
        res.status(404).json({ status: "error", code: "NOT_FOUND" });
        return;
      }
      const setIds = new Set(steps.map((s) => s.id));
      if (parsed.data.order.length !== steps.length) {
        res.status(400).json({ status: "error", code: "INVALID_ORDER" });
        return;
      }
      for (const id of parsed.data.order) {
        if (!setIds.has(id)) {
          res.status(400).json({ status: "error", code: "INVALID_ORDER" });
          return;
        }
      }
      const actor = actorContextForReq(req);
      await db.$transaction(async (tx) => {
        let idx = 1;
        for (const id of parsed.data.order) {
          await tx.pipelineStep.update({
            where: { id },
            data: { sortOrder: idx, updatedBy: actor.actorUserId },
          });
          idx += 1;
        }
        await tx.pipeline.update({
          where: { id: pipelineId },
          data: { updatedBy: actor.actorUserId },
        });
        await appendChangeLog(tx, historyCfg, "PIPELINE", pipelineId, actor, {
          changeKind: "REORDER" as ChangeKind,
          changedPath: "/steps",
        });
      });
      res.sendStatus(204);
    }),
  );

  // POST /pipelines/:id/triggers — attach trigger
  server.post(
    "/pipelines/:id/triggers",
    requireAdminOrApiToken({
      policySignature: "POST /pipelines/:id/triggers" as RouteSignature,
      scopes: [SCOPES.PIPELINES_WRITE],
    })(async (req, res) => {
      const pipelineId = (req.params as Record<string, string> | undefined)?.id;
      if (!pipelineId) {
        res.status(400).json({ status: "error", code: "BAD_REQUEST" });
        return;
      }
      const pipeline = await db.pipeline.findUnique({
        where: { id: pipelineId },
        select: { id: true },
      });
      if (!pipeline) {
        res.status(404).json({ status: "error", code: "NOT_FOUND" });
        return;
      }
      const Body = z.object({
        triggerId: z.string().min(1),
        sortOrder: z.coerce.number().int().min(1).optional(),
        isEnabled: z.boolean().optional(),
      });
      const parsed = Body.safeParse(req.body ?? {});
      if (!parsed.success) {
        res.status(400).json({ status: "error", code: "BAD_REQUEST" });
        return;
      }
      const trigger = await db.triggerDefinition.findUnique({
        where: { id: parsed.data.triggerId },
      });
      if (!trigger || trigger.isEnabled === false) {
        res.status(400).json({ status: "error", code: "INVALID_TRIGGER" });
        return;
      }
      const existingLink = await db.pipelineTrigger.findUnique({
        where: { pipelineId_triggerId: { pipelineId, triggerId: parsed.data.triggerId } },
      });
      if (existingLink) {
        res.status(409).json({ status: "error", code: "ALREADY_ATTACHED" });
        return;
      }
      const actor = actorContextForReq(req);
      const result = await db.$transaction(async (tx) => {
        const existing = await tx.pipelineTrigger.findMany({
          where: { pipelineId },
          orderBy: { sortOrder: "asc" },
          select: { triggerId: true, sortOrder: true },
        });
        const desiredOrderRaw = parsed.data.sortOrder ?? existing.length + 1;
        const desiredOrder = Math.min(Math.max(desiredOrderRaw, 1), existing.length + 1);
        if (parsed.data.sortOrder !== undefined) {
          for (const t of existing.filter((tr) => tr.sortOrder >= desiredOrder)) {
            await tx.pipelineTrigger.update({
              where: { pipelineId_triggerId: { pipelineId, triggerId: t.triggerId } },
              data: { sortOrder: t.sortOrder + 1, updatedBy: actor.actorUserId },
            });
          }
        }
        const created = await tx.pipelineTrigger.create({
          data: {
            pipelineId,
            triggerId: parsed.data.triggerId,
            sortOrder: parsed.data.sortOrder !== undefined ? desiredOrder : existing.length + 1,
            isEnabled: parsed.data.isEnabled ?? true,
            createdBy: actor.actorUserId,
          },
        });
        await tx.pipeline.update({
          where: { id: pipelineId },
          data: { updatedBy: actor.actorUserId },
        });
        await appendChangeLog(tx, historyCfg, "PIPELINE", pipelineId, actor, {
          changeKind: "ADD_CHILD" as ChangeKind,
          changedPath: "/triggers",
        });
        await resequenceTriggers(tx, pipelineId, actor.actorUserId);
        return created;
      });
      res.status(201).json({
        triggerId: result.triggerId,
        sortOrder: result.sortOrder,
        isEnabled: result.isEnabled,
      });
    }),
  );

  // PATCH /pipelines/:id/triggers/:triggerId — update link
  server.patch(
    "/pipelines/:id/triggers/:triggerId",
    requireAdminOrApiToken({
      policySignature: "PATCH /pipelines/:id/triggers/:triggerId" as RouteSignature,
      scopes: [SCOPES.PIPELINES_WRITE],
    })(async (req, res) => {
      const params = req.params as Record<string, string> | undefined;
      const pipelineId = params?.id;
      const triggerId = params?.triggerId;
      if (!pipelineId || !triggerId) {
        res.status(400).json({ status: "error", code: "BAD_REQUEST" });
        return;
      }
      const link = await db.pipelineTrigger.findUnique({
        where: { pipelineId_triggerId: { pipelineId, triggerId } },
        select: { sortOrder: true },
      });
      if (!link) {
        res.status(404).json({ status: "error", code: "NOT_FOUND" });
        return;
      }
      const Body = z.object({
        isEnabled: z.boolean().optional(),
        sortOrder: z.coerce.number().int().min(1).optional(),
      });
      const parsed = Body.safeParse(req.body ?? {});
      if (
        !parsed.success ||
        (parsed.data.isEnabled === undefined && parsed.data.sortOrder === undefined)
      ) {
        res.status(400).json({ status: "error", code: "BAD_REQUEST" });
        return;
      }
      const actor = actorContextForReq(req);
      await db.$transaction(async (tx) => {
        if (parsed.data.sortOrder !== undefined) {
          const triggers = await tx.pipelineTrigger.findMany({
            where: { pipelineId },
            orderBy: { sortOrder: "asc" },
            select: { triggerId: true, sortOrder: true },
          });
          const desired = Math.min(Math.max(parsed.data.sortOrder, 1), triggers.length);
          for (const trig of triggers) {
            if (trig.triggerId === triggerId) continue;
            let newOrder = trig.sortOrder;
            if (trig.sortOrder >= desired && link.sortOrder < desired) {
              newOrder = trig.sortOrder - 1;
            } else if (trig.sortOrder <= desired && link.sortOrder > desired) {
              newOrder = trig.sortOrder + 1;
            }
            if (newOrder !== trig.sortOrder) {
              await tx.pipelineTrigger.update({
                where: { pipelineId_triggerId: { pipelineId, triggerId: trig.triggerId } },
                data: { sortOrder: newOrder, updatedBy: actor.actorUserId },
              });
            }
          }
          await tx.pipelineTrigger.update({
            where: { pipelineId_triggerId: { pipelineId, triggerId } },
            data: { sortOrder: desired, updatedBy: actor.actorUserId },
          });
        }
        if (parsed.data.isEnabled !== undefined) {
          await tx.pipelineTrigger.update({
            where: { pipelineId_triggerId: { pipelineId, triggerId } },
            data: { isEnabled: parsed.data.isEnabled, updatedBy: actor.actorUserId },
          });
        } else {
          await tx.pipelineTrigger.update({
            where: { pipelineId_triggerId: { pipelineId, triggerId } },
            data: { updatedBy: actor.actorUserId },
          });
        }
        await tx.pipeline.update({
          where: { id: pipelineId },
          data: { updatedBy: actor.actorUserId },
        });
        await appendChangeLog(tx, historyCfg, "PIPELINE", pipelineId, actor, {
          changeKind:
            parsed.data.sortOrder !== undefined
              ? ("REORDER" as ChangeKind)
              : ("UPDATE_CHILD" as ChangeKind),
          changedPath: "/triggers",
        });
        await resequenceTriggers(tx, pipelineId, actor.actorUserId);
      });
      res.sendStatus(204);
    }),
  );

  // DELETE /pipelines/:id/triggers/:triggerId
  server.delete(
    "/pipelines/:id/triggers/:triggerId",
    requireAdminOrApiToken({
      policySignature: "DELETE /pipelines/:id/triggers/:triggerId" as RouteSignature,
      scopes: [SCOPES.PIPELINES_WRITE],
    })(async (req, res) => {
      const params = req.params as Record<string, string> | undefined;
      const pipelineId = params?.id;
      const triggerId = params?.triggerId;
      if (!pipelineId || !triggerId) {
        res.status(400).json({ status: "error", code: "BAD_REQUEST" });
        return;
      }
      const link = await db.pipelineTrigger.findUnique({
        where: { pipelineId_triggerId: { pipelineId, triggerId } },
      });
      if (!link) {
        res.status(404).json({ status: "error", code: "NOT_FOUND" });
        return;
      }
      const actor = actorContextForReq(req);
      await db.$transaction(async (tx) => {
        await tx.pipelineTrigger.delete({
          where: { pipelineId_triggerId: { pipelineId, triggerId } },
        });
        await resequenceTriggers(tx, pipelineId, actor.actorUserId);
        await tx.pipeline.update({
          where: { id: pipelineId },
          data: { updatedBy: actor.actorUserId },
        });
        await appendChangeLog(tx, historyCfg, "PIPELINE", pipelineId, actor, {
          changeKind: "REMOVE_CHILD" as ChangeKind,
          changedPath: "/triggers",
        });
      });
      res.sendStatus(204);
    }),
  );

  // POST /pipelines/:id/triggers/reorder
  server.post(
    "/pipelines/:id/triggers/reorder",
    requireAdminOrApiToken({
      policySignature: "POST /pipelines/:id/triggers/reorder" as RouteSignature,
      scopes: [SCOPES.PIPELINES_WRITE],
    })(async (req, res) => {
      const pipelineId = (req.params as Record<string, string> | undefined)?.id;
      if (!pipelineId) {
        res.status(400).json({ status: "error", code: "BAD_REQUEST" });
        return;
      }
      const Body = z.object({
        order: z.array(z.string().min(1)).min(1),
      });
      const parsed = Body.safeParse(req.body ?? {});
      if (!parsed.success) {
        res.status(400).json({ status: "error", code: "BAD_REQUEST" });
        return;
      }
      const triggers = await db.pipelineTrigger.findMany({
        where: { pipelineId },
        select: { triggerId: true },
      });
      if (!triggers.length) {
        res.status(404).json({ status: "error", code: "NOT_FOUND" });
        return;
      }
      const setIds = new Set(triggers.map((t) => t.triggerId));
      if (parsed.data.order.length !== triggers.length) {
        res.status(400).json({ status: "error", code: "INVALID_ORDER" });
        return;
      }
      for (const tid of parsed.data.order) {
        if (!setIds.has(tid)) {
          res.status(400).json({ status: "error", code: "INVALID_ORDER" });
          return;
        }
      }
      const actor = actorContextForReq(req);
      await db.$transaction(async (tx) => {
        let idx = 1;
        for (const tid of parsed.data.order) {
          await tx.pipelineTrigger.update({
            where: { pipelineId_triggerId: { pipelineId, triggerId: tid } },
            data: { sortOrder: idx, updatedBy: actor.actorUserId },
          });
          idx += 1;
        }
        await tx.pipeline.update({
          where: { id: pipelineId },
          data: { updatedBy: actor.actorUserId },
        });
        await appendChangeLog(tx, historyCfg, "PIPELINE", pipelineId, actor, {
          changeKind: "REORDER" as ChangeKind,
          changedPath: "/triggers",
        });
      });
      res.sendStatus(204);
    }),
  );

  // GET /pipelines/:id/versions — list history
  server.get(
    "/pipelines/:id/versions",
    requireAdminOrApiToken({
      policySignature: "GET /pipelines/:id/versions" as RouteSignature,
      scopes: [SCOPES.PIPELINES_READ],
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
          entityType: "PIPELINE",
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

  // GET /pipelines/:id/versions/:version — materialized state
  server.get(
    "/pipelines/:id/versions/:version",
    requireAdminOrApiToken({
      policySignature: "GET /pipelines/:id/versions/:version" as RouteSignature,
      scopes: [SCOPES.PIPELINES_READ],
    })(async (req, res) => {
      const params = req.params as Record<string, string> | undefined;
      const id = params?.id;
      const versionNum = params?.version ? Number(params.version) : NaN;
      if (!id || Number.isNaN(versionNum) || versionNum < 1) {
        res.status(400).json({ status: "error", code: "BAD_REQUEST" });
        return;
      }
      const row = await db.changeLog.findFirst({
        where: { entityType: "PIPELINE", entityId: id, version: versionNum },
      });
      if (!row) {
        res.status(404).json({ status: "error", code: "NOT_FOUND" });
        return;
      }
      const state = await materializeVersion(db, "PIPELINE", id, versionNum);
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
