import { z } from "zod";
import type { HttpServer } from "../../http/http-server.js";
import { getDb } from "../../db/db.js";
import type { Prisma } from "@latchflow/db";
import { requireAdminOrApiToken } from "../../middleware/require-admin-or-api-token.js";
import { SCOPES } from "../../auth/scopes.js";
import type { RouteSignature } from "../../authz/policy.js";
import { toFileDto, type FileRecordLike } from "../../dto/file.js";
import type { BundleRebuildScheduler } from "../../bundles/scheduler.js";

export function registerBundleObjectsAdminRoutes(
  server: HttpServer,
  deps: { scheduler: BundleRebuildScheduler },
) {
  const db = getDb();

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
        const items = rows.map((r) => ({
          bundleObject: {
            id: r.id,
            bundleId: r.bundleId,
            fileId: r.fileId,
            path: r.path ?? undefined,
            sortOrder: r.sortOrder,
            required: r.required,
            addedAt:
              r.addedAt instanceof Date
                ? r.addedAt.toISOString()
                : (r.addedAt as unknown as string),
          },
          file: r.file ? toFileDto(asFileRecord(r.file)) : undefined,
        }));
        const last = rows[rows.length - 1];
        const nextCursor = last
          ? Buffer.from(
              JSON.stringify({ sortOrder: Number(last.sortOrder ?? 0), id: last.id }),
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

  // POST /bundles/:bundleId/objects — attach files to bundle
  server.post(
    "/bundles/:bundleId/objects",
    requireAdminOrApiToken({
      policySignature: "POST /bundles/:bundleId/objects" as RouteSignature,
      scopes: [SCOPES.BUNDLES_WRITE],
    })(async (req, res) => {
      try {
        const P = z.object({ bundleId: z.string().min(1) });
        const payloadItem = z.object({
          fileId: z.string().min(1),
          path: z.string().optional(),
          sortOrder: z.coerce.number().int().optional(),
          required: z.coerce.boolean().optional(),
        });
        const B = z.union([
          z.array(payloadItem).min(1),
          z.object({ items: z.array(payloadItem).min(1) }),
        ]);
        const params = P.safeParse(req.params ?? {});
        const body = B.safeParse(req.body ?? {});
        if (!params.success || !body.success) {
          res.status(400).json({ status: "error", code: "BAD_REQUEST", message: "Invalid input" });
          return;
        }
        const bundleId = params.data.bundleId;
        const items = Array.isArray(body.data) ? body.data : body.data.items;

        // Pre-fetch file.key for items missing path
        const missingPathIds = Array.from(
          new Set(items.filter((i) => !i.path).map((i) => i.fileId)),
        );
        const files = missingPathIds.length
          ? await db.file.findMany({
              where: { id: { in: missingPathIds } },
              select: { id: true, key: true },
            })
          : [];
        const keyById = new Map(files.map((f) => [f.id, f.key] as const));

        // Determine next sortOrder base once
        const last = await db.bundleObject.findFirst({
          where: { bundleId },
          orderBy: { sortOrder: "desc" },
          select: { sortOrder: true },
        });
        let nextSort = (last?.sortOrder ?? -1) + 1;
        const createdBy = (req.user?.id as string | undefined) ?? "system";

        // Attach items idempotently (upsert on unique [bundleId, fileId])
        const created = [] as {
          id: string;
          bundleId: string;
          fileId: string;
          path: string | null;
          sortOrder: number;
          required: boolean;
          addedAt: Date;
        }[];
        for (const it of items) {
          const path = it.path ?? keyById.get(it.fileId) ?? null;
          const sortOrder = typeof it.sortOrder === "number" ? it.sortOrder : nextSort++;
          const required = Boolean(it.required ?? false);
          const row = (await db.bundleObject
            .upsert({
              where: {
                bundleId_fileId: { bundleId, fileId: it.fileId },
              } as unknown as Prisma.BundleObjectWhereUniqueInput,
              update: {},
              create: {
                bundleId,
                fileId: it.fileId,
                path,
                sortOrder,
                required,
                createdBy,
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
            .catch((e: unknown) => {
              // If unknown error, rethrow; unique conflicts are handled by upsert
              throw e;
            })) as unknown as (typeof created)[number];
          created.push(row);
        }

        try {
          deps.scheduler.schedule(bundleId);
        } catch {
          // ignore scheduling failures
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

  // POST (PATCH) /bundles/:bundleId/objects/:id — update object fields
  server.post(
    "/bundles/:bundleId/objects/:id",
    requireAdminOrApiToken({
      policySignature: "PATCH /bundles/:bundleId/objects/:id" as RouteSignature,
      scopes: [SCOPES.BUNDLES_WRITE],
    })(async (req, res) => {
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
        // Use UncheckedUpdateInput so we can set the scalar updatedBy field directly
        // (the checked UpdateInput exposes only the relation `updater`).
        const patch: Prisma.BundleObjectUncheckedUpdateInput = {};
        if ("path" in body.data) patch.path = body.data.path ?? null;
        if ("sortOrder" in body.data) patch.sortOrder = body.data.sortOrder!;
        if ("required" in body.data) patch.required = body.data.required!;
        if ("isEnabled" in body.data) patch.isEnabled = body.data.isEnabled!;
        if (Object.keys(patch).length === 0) {
          res.status(400).json({ status: "error", code: "BAD_REQUEST", message: "Empty patch" });
          return;
        }
        const updatedBy = (req.user?.id as string | undefined) ?? "system";
        patch.updatedBy = updatedBy;
        await db.bundleObject.update({ where: { id }, data: patch });
        try {
          deps.scheduler.schedule(bundleId);
        } catch {
          // ignore scheduling failures
        }
        res.status(204).json({});
      } catch (e) {
        const err = e as Error & { status?: number };
        res
          .status(err.status ?? 401)
          .json({ status: "error", code: "UNAUTHORIZED", message: err.message });
      }
    }),
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
        await db.bundleObject.deleteMany({ where: { id, bundleId } });
        try {
          deps.scheduler.schedule(bundleId);
        } catch {
          // ignore scheduling failures
        }
        res.status(204).json({});
      } catch (e) {
        const err = e as Error & { status?: number };
        res
          .status(err.status ?? 401)
          .json({ status: "error", code: "UNAUTHORIZED", message: err.message });
      }
    }),
  );
}
