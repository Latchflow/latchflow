import { z } from "zod";
import type { HttpServer, HttpHandler } from "../../http/http-server.js";
import { getDb } from "../../db/db.js";
import type { Prisma, ChangeKind } from "@latchflow/db";
import { requireAdminOrApiToken } from "../../middleware/require-admin-or-api-token.js";
import { SCOPES } from "../../auth/scopes.js";
import type { RouteSignature } from "../../authz/policy.js";
import { toFileDto, type FileRecordLike } from "../../dto/file.js";
import type { BundleRebuildScheduler } from "../../bundles/scheduler.js";
import { appendChangeLog } from "../../history/changelog.js";
import type { AppConfig } from "../../config/config.js";

const CHANGE_PATH = "/objects";

type ChangeOpts = {
  changeKind: ChangeKind;
  changedPath?: string | null;
};

const DEFAULT_CHANGE_OPTS: ChangeOpts = { changeKind: "UPDATE_CHILD" };

export function registerBundleObjectsAdminRoutes(
  server: HttpServer,
  deps: { scheduler: BundleRebuildScheduler; config?: AppConfig },
) {
  const db = getDb();
  const config: Pick<
    AppConfig,
    "HISTORY_SNAPSHOT_INTERVAL" | "HISTORY_MAX_CHAIN_DEPTH" | "SYSTEM_USER_ID"
  > = deps.config ?? {
    HISTORY_SNAPSHOT_INTERVAL: 20,
    HISTORY_MAX_CHAIN_DEPTH: 200,
    SYSTEM_USER_ID: "system",
  };
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

  const recordBundleChange = async (
    bundleId: string,
    actor: ReturnType<typeof actorContextForReq>,
    opts: ChangeOpts = DEFAULT_CHANGE_OPTS,
  ) => {
    await appendChangeLog(db, historyCfg, "BUNDLE", bundleId, actor, {
      changeKind: opts.changeKind,
      changedPath: opts.changedPath ?? CHANGE_PATH,
    });
  };

  const asFileRecord = (f: {
    id: string;
    key: string;
    size: bigint | number;
    contentType: string;
    metadata: unknown;
    contentHash: string | null;
    etag: string | null;
    updatedAt: Date | string;
  }): FileRecordLike => {
    const meta =
      typeof f.metadata === "object" && f.metadata !== null
        ? (f.metadata as Record<string, string>)
        : undefined;
    return {
      id: f.id,
      key: f.key,
      size: f.size,
      contentType: f.contentType,
      metadata: meta,
      contentHash: f.contentHash ?? undefined,
      etag: f.etag ?? undefined,
      updatedAt: f.updatedAt,
    };
  };

  const scheduleRebuild = (bundleId: string) => {
    try {
      deps.scheduler.schedule(bundleId);
    } catch {
      // ignore scheduler failures
    }
  };

  // GET /bundles/:bundleId/objects — list bundle objects with file metadata
  server.get(
    "/bundles/:bundleId/objects",
    requireAdminOrApiToken({
      policySignature: "GET /bundles/:bundleId/objects" as RouteSignature,
      scopes: [SCOPES.BUNDLES_READ],
    })(async (req, res) => {
      try {
        const P = z.object({ bundleId: z.string().min(1) });
        const Q = z.object({
          limit: z.coerce.number().int().min(1).max(200).optional(),
          cursor: z.string().optional(),
        });
        const params = P.safeParse(req.params ?? {});
        const qp = Q.safeParse(req.query ?? {});
        if (!params.success || !qp.success) {
          res.status(400).json({ status: "error", code: "BAD_REQUEST", message: "Invalid input" });
          return;
        }
        const bundleId = params.data.bundleId;
        const limit = qp.data.limit ?? 50;
        const raw = qp.data.cursor;
        let after: { sortOrder: number; id: string } | null = null;
        if (raw) {
          try {
            const obj = JSON.parse(Buffer.from(raw, "base64").toString("utf8"));
            if (
              obj &&
              typeof obj.sortOrder === "number" &&
              typeof obj.id === "string" &&
              obj.id.length > 0
            ) {
              after = { sortOrder: obj.sortOrder, id: obj.id };
            }
          } catch {
            // ignore bad cursor
          }
        }
        const whereBase: Prisma.BundleObjectWhereInput = { bundleId };
        const where = after
          ? ({
              AND: [
                whereBase,
                {
                  OR: [
                    { sortOrder: { gt: after.sortOrder } },
                    { AND: [{ sortOrder: after.sortOrder }, { id: { gt: after.id } }] },
                  ],
                },
              ],
            } as Prisma.BundleObjectWhereInput)
          : whereBase;

        type Row = {
          id: string;
          bundleId: string;
          fileId: string;
          path: string | null;
          sortOrder: number;
          required: boolean;
          addedAt: Date | string;
          file: {
            id: string;
            key: string;
            size: number | bigint;
            contentType: string;
            metadata: unknown;
            contentHash: string | null;
            etag: string | null;
            updatedAt: Date | string;
          } | null;
        };
        const rows = (await db.bundleObject.findMany({
          where,
          take: limit,
          orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
          select: {
            id: true,
            bundleId: true,
            fileId: true,
            path: true,
            sortOrder: true,
            required: true,
            addedAt: true,
            file: {
              select: {
                id: true,
                key: true,
                size: true,
                contentType: true,
                metadata: true,
                contentHash: true,
                etag: true,
                updatedAt: true,
              },
            },
          },
        })) as unknown as Row[];

        const items = rows.map((row) => ({
          bundleObject: {
            id: row.id,
            fileId: row.fileId,
            path: row.path,
            sortOrder: row.sortOrder,
            required: row.required,
            addedAt: row.addedAt,
          },
          file: row.file ? toFileDto(asFileRecord(row.file)) : null,
        }));

        const last = rows[rows.length - 1];
        const nextCursor = last
          ? Buffer.from(
              JSON.stringify({ sortOrder: last.sortOrder, id: last.id }),
              "utf8",
            ).toString("base64")
          : undefined;

        res.status(200).json({ items, ...(nextCursor ? { nextCursor } : {}) });
      } catch (e) {
        const err = e as Error & { status?: number };
        res
          .status(err.status ?? 401)
          .json({ status: "error", code: "UNAUTHORIZED", message: err.message });
      }
    }),
  );

  // POST /bundles/:bundleId/objects — attach files (array or object.items)
  server.post(
    "/bundles/:bundleId/objects",
    requireAdminOrApiToken({
      policySignature: "POST /bundles/:bundleId/objects" as RouteSignature,
      scopes: [SCOPES.BUNDLES_WRITE],
    })(async (req, res) => {
      try {
        const P = z.object({ bundleId: z.string().min(1) });
        const params = P.safeParse(req.params ?? {});
        if (!params.success) {
          res.status(400).json({ status: "error", code: "BAD_REQUEST", message: "Invalid input" });
          return;
        }
        const bundleId = params.data.bundleId;
        const Body = z
          .union([
            z.array(
              z.object({
                fileId: z.string().min(1),
                path: z.string().min(1).optional(),
                sortOrder: z.coerce.number().int().optional(),
                required: z.coerce.boolean().optional(),
              }),
            ),
            z.object({
              items: z.array(
                z.object({
                  fileId: z.string().min(1),
                  path: z.string().min(1).optional(),
                  sortOrder: z.coerce.number().int().optional(),
                  required: z.coerce.boolean().optional(),
                }),
              ),
            }),
          ])
          .transform((payload) => (Array.isArray(payload) ? payload : (payload.items ?? [])));
        const parsed = Body.safeParse(req.body ?? {});
        if (!parsed.success || parsed.data.length === 0) {
          res.status(400).json({ status: "error", code: "BAD_REQUEST", message: "Invalid body" });
          return;
        }

        const actor = actorContextForReq(req);
        const items = parsed.data;

        const fileIdsMissingPath = items.filter((item) => !item.path).map((item) => item.fileId);
        let keyById = new Map<string, string>();
        if (fileIdsMissingPath.length > 0) {
          const files = await db.file.findMany({
            where: { id: { in: fileIdsMissingPath } },
            select: { id: true, key: true },
          });
          keyById = new Map(files.map((f: { id: string; key: string }) => [f.id, f.key]));
        }

        // Determine next sort order base
        const last = await db.bundleObject.findFirst({
          where: { bundleId },
          orderBy: { sortOrder: "desc" },
          select: { sortOrder: true },
        });
        let nextSort = (last?.sortOrder ?? 0) + 1;

        const created: Array<{
          id: string;
          bundleId: string;
          fileId: string;
          path: string | null;
          sortOrder: number;
          required: boolean;
          addedAt: Date | string;
        }> = [];

        let mutated = false;
        for (const item of items) {
          const path = item.path ?? keyById.get(item.fileId) ?? null;
          const sortOrder = typeof item.sortOrder === "number" ? item.sortOrder : nextSort++;
          const required = Boolean(item.required ?? false);
          const result = (await db.bundleObject
            .upsert({
              where: {
                bundleId_fileId: { bundleId, fileId: item.fileId },
              } as unknown as Prisma.BundleObjectWhereUniqueInput,
              update: {
                path,
                sortOrder,
                required,
                updatedBy: actor.actorUserId,
              },
              create: {
                bundleId,
                fileId: item.fileId,
                path,
                sortOrder,
                required,
                createdBy: actor.actorUserId,
              },
              select: {
                id: true,
                bundleId: true,
                fileId: true,
                path: true,
                sortOrder: true,
                required: true,
                addedAt: true,
              },
            })
            .catch((err: unknown) => {
              throw err;
            })) as unknown as (typeof created)[number];
          created.push(result);
          mutated = true;
        }

        scheduleRebuild(bundleId);

        if (mutated) {
          await recordBundleChange(bundleId, actor, { changeKind: "UPDATE_CHILD" });
        }

        res.status(201).json({ items: created });
      } catch (e) {
        const err = e as Error & { status?: number };
        res
          .status(err.status ?? 401)
          .json({ status: "error", code: "UNAUTHORIZED", message: err.message });
      }
    }),
  );

  const updateHandler: HttpHandler = async (req, res) => {
    try {
      const P = z.object({ bundleId: z.string().min(1), id: z.string().min(1) });
      const B = z.object({
        path: z.string().optional(),
        sortOrder: z.coerce.number().int().optional(),
        required: z.coerce.boolean().optional(),
        isEnabled: z.coerce.boolean().optional(),
      });
      const params = P.safeParse(req.params ?? {});
      const body = B.safeParse(req.body ?? {});
      if (!params.success || !body.success) {
        res.status(400).json({ status: "error", code: "BAD_REQUEST", message: "Invalid input" });
        return;
      }
      const { bundleId, id } = params.data;
      const existing = await db.bundleObject.findUnique({
        select: { bundleId: true },
        where: { id },
      });
      if (!existing || existing.bundleId !== bundleId) {
        res.status(404).json({ status: "error", code: "NOT_FOUND", message: "Not found" });
        return;
      }
      const patch: Prisma.BundleObjectUncheckedUpdateInput = {};
      if ("path" in body.data) patch.path = body.data.path ?? null;
      if ("sortOrder" in body.data) patch.sortOrder = body.data.sortOrder!;
      if ("required" in body.data) patch.required = body.data.required!;
      if ("isEnabled" in body.data) patch.isEnabled = body.data.isEnabled!;
      if (Object.keys(patch).length === 0) {
        res.status(400).json({ status: "error", code: "BAD_REQUEST", message: "Empty patch" });
        return;
      }
      const actor = actorContextForReq(req);
      patch.updatedBy = actor.actorUserId;
      await db.bundleObject.update({ where: { id }, data: patch });
      scheduleRebuild(bundleId);
      await recordBundleChange(bundleId, actor, { changeKind: "UPDATE_CHILD" });
      res.sendStatus(204);
    } catch (e) {
      const err = e as Error & { status?: number };
      res
        .status(err.status ?? 401)
        .json({ status: "error", code: "UNAUTHORIZED", message: err.message });
    }
  };

  // Support both POST (legacy) and PATCH verbs for updates
  server.patch(
    "/bundles/:bundleId/objects/:id",
    requireAdminOrApiToken({
      policySignature: "PATCH /bundles/:bundleId/objects/:id" as RouteSignature,
      scopes: [SCOPES.BUNDLES_WRITE],
    })(updateHandler),
  );

  // DELETE /bundles/:bundleId/objects/:id — detach
  server.delete(
    "/bundles/:bundleId/objects/:id",
    requireAdminOrApiToken({
      policySignature: "DELETE /bundles/:bundleId/objects/:id" as RouteSignature,
      scopes: [SCOPES.BUNDLES_WRITE],
    })(async (req, res) => {
      try {
        const P = z.object({ bundleId: z.string().min(1), id: z.string().min(1) });
        const params = P.safeParse(req.params ?? {});
        if (!params.success) {
          res.status(400).json({ status: "error", code: "BAD_REQUEST", message: "Invalid input" });
          return;
        }
        const { bundleId, id } = params.data;
        const actor = actorContextForReq(req);
        const result = (await db.bundleObject.deleteMany({
          where: { id, bundleId },
        })) as unknown as { count?: number } | void;
        const count = typeof result === "object" && result ? (result.count ?? 0) : 0;
        scheduleRebuild(bundleId);
        if (count > 0) {
          await recordBundleChange(bundleId, actor, { changeKind: "REMOVE_CHILD" });
        }
        res.sendStatus(204);
      } catch (e) {
        const err = e as Error & { status?: number };
        res
          .status(err.status ?? 401)
          .json({ status: "error", code: "UNAUTHORIZED", message: err.message });
      }
    }),
  );
}
