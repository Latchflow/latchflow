import { z } from "zod";
import fs from "node:fs";
import type { HttpServer } from "../../http/http-server.js";
import { getDb } from "../../db/db.js";
import type { Prisma } from "@latchflow/db";
import { requireAdminOrApiToken } from "../../middleware/require-admin-or-api-token.js";
import { SCOPES } from "../../auth/scopes.js";
import type { RouteSignature } from "../../authz/policy.js";
import { toFileDto, type FileRecordLike } from "../../dto/file.js";
import type { StorageService } from "../../storage/service.js";

export function registerFileAdminRoutes(server: HttpServer, deps: { storage: StorageService }) {
  const db = getDb();
  const storage = deps.storage;

  const asFileRecord = (f: {
    id: string;
    key: string;
    size: bigint;
    contentType: string;
    metadata: unknown;
    contentHash: string | null;
    updatedAt: Date;
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
      updatedAt: f.updatedAt,
    };
  };

  // GET /files — list
  server.get(
    "/files",
    requireAdminOrApiToken({
      policySignature: "GET /files" as RouteSignature,
      scopes: [SCOPES.FILES_READ],
    })(async (req, res) => {
      try {
        const Q = z.object({
          limit: z.coerce.number().int().min(1).max(200).optional(),
          cursor: z.string().optional(),
          prefix: z.string().optional(),
          q: z.string().optional(),
          unassigned: z.coerce.boolean().optional(),
        });
        const qp = Q.safeParse(req.query ?? {});
        const q = qp.success ? qp.data : {};
        const where: Prisma.FileWhereInput = {};
        if (q.prefix) where.key = { startsWith: q.prefix };
        if (q.q) where.key = { contains: q.q, mode: "insensitive" };
        if (q.unassigned) where.bundleObjects = { none: {} };
        const items = await db.file.findMany({
          where,
          orderBy: { id: "desc" },
          take: q.limit ?? 50,
          ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
          select: {
            id: true,
            key: true,
            size: true,
            contentType: true,
            metadata: true,
            contentHash: true,
            updatedAt: true,
          },
        });
        const nextCursor =
          items.length === (q.limit ?? 50) ? items[items.length - 1]?.id : undefined;
        res.status(200).json({ items: items.map((f) => toFileDto(asFileRecord(f))), nextCursor });
      } catch (e) {
        const err = e as Error & { status?: number };
        res
          .status(err.status ?? 401)
          .json({ status: "error", code: "UNAUTHORIZED", message: err.message });
      }
    }),
  );

  // POST /files/upload — multipart upload (single file)
  server.post(
    "/files/upload",
    requireAdminOrApiToken({
      policySignature: "POST /files/upload" as RouteSignature,
      scopes: [SCOPES.FILES_WRITE],
    })(async (req, res) => {
      // We accept either disk-backed file (req.file.path) or memory buffer (req.file.buffer)
      try {
        const body = (req.body as Record<string, unknown>) || {};
        const key = typeof body["key"] === "string" ? (body["key"] as string) : undefined;
        const metadata = (() => {
          const m = body["metadata"] as unknown;
          if (m && typeof m === "object") return m as Record<string, string>;
          if (typeof m === "string") {
            try {
              const parsed = JSON.parse(m);
              if (parsed && typeof parsed === "object") return parsed as Record<string, string>;
            } catch {
              // ignore JSON parse errors
            }
          }
          return undefined;
        })();
        const f = req.file;
        if (!f || (!f.path && !f.buffer)) {
          res.status(400).json({ status: "error", code: "BAD_REQUEST", message: "Missing file" });
          return;
        }
        const contentType = f.mimetype || "application/octet-stream";
        let result: { storageKey: string; size: number; etag: string };
        const tmpPathToCleanup: string | null = f.path ?? null;
        try {
          if (f.path) {
            result = await storage.putFileFromPath({ path: f.path, contentType });
          } else if (f.buffer) {
            result = await storage.putFile({ body: f.buffer, contentType });
          } else {
            res.status(400).json({ status: "error", code: "BAD_REQUEST", message: "Missing file" });
            return;
          }
        } finally {
          if (tmpPathToCleanup) {
            fs.promises.unlink(tmpPathToCleanup).catch(() => void 0);
          }
        }
        const now = new Date();
        // Persist File record (requires unique logical key)
        if (!key) {
          res
            .status(400)
            .json({ status: "error", code: "BAD_REQUEST", message: "Missing key field" });
          return;
        }
        const createdBy = req.user?.id ?? "system";
        type DbSelectedFile = {
          id: string;
          key: string;
          size: bigint;
          contentType: string;
          metadata: unknown;
          contentHash: string | null;
          updatedAt: Date;
        };
        let file: DbSelectedFile;
        try {
          file = (await db.file.create({
            data: {
              key,
              storageKey: result.storageKey,
              contentHash: result.etag,
              size: BigInt(result.size),
              contentType,
              metadata: metadata ?? undefined,
              createdBy,
              updatedBy: createdBy,
              createdAt: now,
              updatedAt: now,
            },
            select: {
              id: true,
              key: true,
              size: true,
              contentType: true,
              metadata: true,
              contentHash: true,
              updatedAt: true,
            },
          })) as DbSelectedFile;
        } catch (e) {
          const pe = e as { code?: string; message?: string };
          if (pe && pe.code === "P2002") {
            res
              .status(409)
              .json({ status: "error", code: "CONFLICT", message: "Key already exists" });
            return;
          }
          throw e;
        }
        // ETag response header
        res.header("ETag", result.etag);
        res.header("Location", `/files/${file.id}`);
        res.status(201).json(toFileDto(asFileRecord(file)));
      } catch (e) {
        const err = e as Error & { status?: number };
        res
          .status(err.status ?? 500)
          .json({ status: "error", code: "UPLOAD_FAILED", message: err.message });
      }
    }),
  );

  // POST /files/upload-url — stub 501 unless driver advertises support (future)
  server.post(
    "/files/upload-url",
    requireAdminOrApiToken({
      policySignature: "POST /files/upload-url" as RouteSignature,
      scopes: [SCOPES.FILES_WRITE],
    })(async (_req, res) => {
      res.status(501).json({
        status: "error",
        code: "NOT_IMPLEMENTED",
        message: "Presigned uploads not supported by this driver",
      });
    }),
  );

  // GET /files/:id — get metadata
  server.get(
    "/files/:id",
    requireAdminOrApiToken({
      policySignature: "GET /files/:id" as RouteSignature,
      scopes: [SCOPES.FILES_READ],
    })(async (req, res) => {
      try {
        const P = z.object({ id: z.string().min(1) });
        const parsed = P.safeParse(req.params ?? {});
        if (!parsed.success) {
          res.status(400).json({ status: "error", code: "BAD_REQUEST", message: "Invalid params" });
          return;
        }
        const file = await db.file.findUnique({
          where: { id: parsed.data.id },
          select: {
            id: true,
            key: true,
            size: true,
            contentType: true,
            metadata: true,
            contentHash: true,
            updatedAt: true,
          },
        });
        if (!file) {
          res.status(404).json({ status: "error", code: "NOT_FOUND", message: "Not found" });
          return;
        }
        res.status(200).json(toFileDto(asFileRecord(file)));
      } catch (e) {
        const err = e as Error & { status?: number };
        res
          .status(err.status ?? 401)
          .json({ status: "error", code: "UNAUTHORIZED", message: err.message });
      }
    }),
  );

  // DELETE /files/:id
  server.delete(
    "/files/:id",
    requireAdminOrApiToken({
      policySignature: "DELETE /files/:id" as RouteSignature,
      scopes: [SCOPES.FILES_WRITE],
    })(async (req, res) => {
      const P = z.object({ id: z.string().min(1) });
      const parsed = P.safeParse(req.params ?? {});
      if (!parsed.success) {
        res.status(400).json({ status: "error", code: "BAD_REQUEST", message: "Invalid params" });
        return;
      }
      const id = parsed.data.id;
      try {
        const rec = await db.file.findUnique({ where: { id }, select: { storageKey: true } });
        const storageKey = rec?.storageKey;
        if (storageKey) {
          await storage.deleteFile(storageKey).catch(() => void 0);
        }
      } catch {
        // ignore lookup/storage errors to keep delete idempotent
      }
      // Use deleteMany for idempotency; no throw when 0 rows
      await db.file.deleteMany({ where: { id } }).catch(() => void 0);
      res.status(204).json({});
    }),
  );

  // POST /files/:id/move
  server.post(
    "/files/:id/move",
    requireAdminOrApiToken({
      policySignature: "POST /files/:id/move" as RouteSignature,
      scopes: [SCOPES.FILES_WRITE],
    })(async (req, res) => {
      try {
        const P = z.object({ id: z.string().min(1) });
        const B = z.object({ newKey: z.string().min(1) });
        const parsedP = P.safeParse(req.params ?? {});
        const parsedB = B.safeParse(req.body ?? {});
        if (!parsedP.success || !parsedB.success) {
          res.status(400).json({ status: "error", code: "BAD_REQUEST", message: "Invalid input" });
          return;
        }
        await db.file.update({
          where: { id: parsedP.data.id },
          data: { key: parsedB.data.newKey },
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

  // PATCH /files/:id/metadata
  server.post(
    "/files/:id/metadata",
    requireAdminOrApiToken({
      policySignature: "PATCH /files/:id/metadata" as RouteSignature,
      scopes: [SCOPES.FILES_WRITE],
    })(async (req, res) => {
      try {
        const P = z.object({ id: z.string().min(1) });
        const B = z.object({ metadata: z.record(z.string()) });
        const parsedP = P.safeParse(req.params ?? {});
        const parsedB = B.safeParse(req.body ?? {});
        if (!parsedP.success || !parsedB.success) {
          res.status(400).json({ status: "error", code: "BAD_REQUEST", message: "Invalid input" });
          return;
        }
        await db.file.update({
          where: { id: parsedP.data.id },
          data: { metadata: parsedB.data.metadata },
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

  // GET /files/:id/download
  server.get(
    "/files/:id/download",
    requireAdminOrApiToken({
      policySignature: "GET /files/:id/download" as RouteSignature,
      scopes: [SCOPES.FILES_READ],
    })(async (req, res) => {
      try {
        const P = z.object({ id: z.string().min(1) });
        const parsed = P.safeParse(req.params ?? {});
        if (!parsed.success) {
          res.status(400).json({ status: "error", code: "BAD_REQUEST", message: "Invalid params" });
          return;
        }
        const file = await db.file.findUnique({
          where: { id: parsed.data.id },
          select: {
            id: true,
            key: true,
            size: true,
            contentType: true,
            storageKey: true,
            contentHash: true,
          },
        });
        if (!file || !file.storageKey) {
          res.status(404).json({ status: "error", code: "NOT_FOUND", message: "Not found" });
          return;
        }
        const headers: Record<string, string> = {};
        if (file.contentType) headers["Content-Type"] = file.contentType;
        const size = file.size as unknown as number | bigint | null | undefined;
        if (size != null)
          headers["Content-Length"] = String(typeof size === "bigint" ? Number(size) : size);
        if (file.contentHash) headers["ETag"] = file.contentHash;
        const stream = await storage.getFileStream(file.storageKey);
        res.sendStream(stream, headers);
      } catch (e) {
        const err = e as Error & { status?: number };
        res
          .status(err.status ?? 401)
          .json({ status: "error", code: "UNAUTHORIZED", message: err.message });
      }
    }),
  );
}
