import { z } from "zod";
import fs from "node:fs";
import { randomUUID } from "node:crypto";
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
    etag: string | null;
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
      etag: f.etag ?? undefined,
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
            etag: true,
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
        const overwrite = (() => {
          const v = body["overwrite"] as unknown;
          if (typeof v === "boolean") return v;
          if (typeof v === "string") return v === "true" || v === "1";
          return false;
        })();
        const f = req.file;
        if (!f || (!f.path && !f.buffer)) {
          res.status(400).json({ status: "error", code: "BAD_REQUEST", message: "Missing file" });
          return;
        }
        const contentType = f.mimetype || "application/octet-stream";
        let result: { storageKey: string; size: number; sha256: string; storageEtag?: string };
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
          etag: string | null;
          updatedAt: Date;
        };
        let file: DbSelectedFile;
        try {
          if (overwrite) {
            const existing = await db.file.findUnique({ where: { key } });
            if (existing) {
              file = (await db.file.update({
                where: { key },
                data: {
                  storageKey: result.storageKey,
                  contentHash: result.sha256,
                  etag: result.storageEtag ?? null,
                  size: BigInt(result.size),
                  contentType,
                  metadata: metadata ?? undefined,
                  updatedBy: createdBy,
                  updatedAt: now,
                },
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
              })) as DbSelectedFile;
            } else {
              file = (await db.file.create({
                data: {
                  key,
                  storageKey: result.storageKey,
                  contentHash: result.sha256,
                  etag: result.storageEtag ?? null,
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
                  etag: true,
                  updatedAt: true,
                },
              })) as DbSelectedFile;
            }
          } else {
            file = (await db.file.create({
              data: {
                key,
                storageKey: result.storageKey,
                contentHash: result.sha256,
                etag: result.storageEtag ?? null,
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
                etag: true,
                updatedAt: true,
              },
            })) as DbSelectedFile;
          }
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
        // ETag response header (prefer storage-native, fallback to sha256)
        res.header("ETag", result.storageEtag ?? result.sha256);
        res.header("Location", `/files/${file.id}`);
        res.status(overwrite ? 200 : 201).json(toFileDto(asFileRecord(file)));
      } catch (e) {
        const err = e as Error & { status?: number };
        res
          .status(err.status ?? 500)
          .json({ status: "error", code: "UPLOAD_FAILED", message: err.message });
      }
    }),
  );

  // POST /files/upload-url — issue a presigned PUT URL for direct-to-storage uploads
  server.post(
    "/files/upload-url",
    requireAdminOrApiToken({
      policySignature: "POST /files/upload-url" as RouteSignature,
      scopes: [SCOPES.FILES_WRITE],
    })(async (req, res) => {
      try {
        if (!storage.supportsSignedPut) {
          res.status(501).json({
            status: "error",
            code: "NOT_IMPLEMENTED",
            message: "Presigned uploads not supported by this driver",
          });
          return;
        }
        const B = z.object({
          key: z.string().min(1),
          sha256: z.string().regex(/^[0-9a-fA-F]{64}$/),
          contentType: z.string().optional(),
          size: z.coerce.number().int().positive().optional(),
          metadata: z.record(z.string()).optional(),
          expiresSec: z.coerce.number().int().min(60).max(3600).optional(),
        });
        const parsed = B.safeParse(req.body ?? {});
        if (!parsed.success) {
          res.status(400).json({ status: "error", code: "BAD_REQUEST", message: "Invalid input" });
          return;
        }
        const userId = (req as typeof req & { user?: { id?: string } }).user?.id;
        if (!userId) {
          res.status(401).json({ status: "error", code: "UNAUTHORIZED", message: "No user" });
          return;
        }
        const { key, sha256, contentType, size, metadata, expiresSec } = parsed.data;
        const reservationId = randomUUID();
        const tempKey = storage.tempUploadKey(reservationId);
        const ttlSec = expiresSec ?? 15 * 60;
        const expiresAt = new Date(Date.now() + ttlSec * 1000);
        await db.fileUploadReservation.create({
          data: {
            id: reservationId,
            tempKey,
            desiredKey: key,
            sha256: sha256.toLowerCase(),
            requestedContentType: contentType ?? null,
            requestedSize: size != null ? BigInt(size) : null,
            metadata: metadata ?? null,
            createdBy: userId,
            expiresAt,
          },
        });
        const presign = await storage.createSignedPutUrl({
          storageKey: tempKey,
          contentType,
          expiresSeconds: ttlSec,
          // Include checksum binding and store sha256 as object metadata for HEAD fallback
          headers: {
            "x-amz-checksum-sha256": sha256.toLowerCase(),
            "x-amz-meta-sha256": sha256.toLowerCase(),
          },
        });
        res.status(201).json({
          url: presign.url,
          headers: presign.headers ?? {},
          expiresAt: expiresAt.toISOString(),
          tempKey,
          reservationId,
        });
      } catch (e) {
        const err = e as Error & { status?: number };
        res
          .status(err.status ?? 500)
          .json({ status: "error", code: "UPLOAD_URL_FAILED", message: err.message });
      }
    }),
  );

  // POST /files/commit — finalize a presigned upload by copying to final key and creating File record
  server.post(
    "/files/commit",
    requireAdminOrApiToken({
      policySignature: "POST /files/commit" as RouteSignature,
      scopes: [SCOPES.FILES_WRITE],
    })(async (req, res) => {
      try {
        const B = z
          .object({
            key: z.string().min(1),
            tempKey: z.string().optional(),
            reservationId: z.string().uuid().optional(),
            metadata: z.record(z.string()).optional(),
            contentType: z.string().optional(),
            originalName: z.string().optional(),
            overwrite: z.coerce.boolean().optional(),
          })
          .refine((d) => d.tempKey || d.reservationId, {
            message: "tempKey or reservationId is required",
            path: ["tempKey"],
          });
        const parsed = B.safeParse(req.body ?? {});
        if (!parsed.success) {
          res.status(400).json({ status: "error", code: "BAD_REQUEST", message: "Invalid input" });
          return;
        }
        // Load reservation by id or tempKey
        const rid = parsed.data.reservationId ?? undefined;
        const reservation = rid
          ? await db.fileUploadReservation.findUnique({ where: { id: rid } })
          : await db.fileUploadReservation.findUnique({
              where: { tempKey: parsed.data.tempKey! },
            });
        if (!reservation || reservation.consumedAt) {
          res
            .status(400)
            .json({ status: "error", code: "INVALID_RESERVATION", message: "Missing or consumed" });
          return;
        }
        if (reservation.expiresAt <= new Date()) {
          res
            .status(400)
            .json({ status: "error", code: "EXPIRED", message: "Reservation expired" });
          return;
        }
        if (reservation.desiredKey !== parsed.data.key) {
          res.status(400).json({ status: "error", code: "KEY_MISMATCH", message: "Key mismatch" });
          return;
        }
        const tempKey = reservation.tempKey;
        // Verify checksum via HEAD
        const head = await storage.headRaw(tempKey);
        const checksum = head.checksumSha256Hex ?? head.metadata?.["sha256"];
        if (!checksum || checksum.toLowerCase() !== reservation.sha256.toLowerCase()) {
          res
            .status(400)
            .json({ status: "error", code: "CHECKSUM_MISMATCH", message: "Checksum mismatch" });
          return;
        }
        // Determine final storage key (content addressed)
        const finalStorageKey = storage.contentAddressedKey(reservation.sha256.toLowerCase());
        const ct =
          parsed.data.contentType ??
          reservation.requestedContentType ??
          head.contentType ??
          "application/octet-stream";
        const meta =
          parsed.data.metadata ??
          (reservation.metadata as Record<string, string> | undefined) ??
          undefined;
        const copyRes = await storage.copyObjectRaw({
          srcKey: tempKey,
          destKey: finalStorageKey,
          metadata: meta,
          contentType: ct,
        });
        await storage.deleteFile(tempKey).catch(() => void 0);

        // Upsert File record respecting overwrite flag
        const overwrite = parsed.data.overwrite === true;
        type DbSelectedFile = {
          id: string;
          key: string;
          size: bigint;
          contentType: string;
          metadata: unknown;
          contentHash: string | null;
          etag: string | null;
          updatedAt: Date;
        };
        let file: DbSelectedFile;
        if (overwrite) {
          const existing = await db.file.findUnique({ where: { key: parsed.data.key } });
          if (existing) {
            file = (await db.file.update({
              where: { id: existing.id },
              data: {
                size: BigInt(head.size),
                contentType: ct,
                metadata: meta ?? null,
                contentHash: reservation.sha256.toLowerCase(),
                storageKey: finalStorageKey,
                etag: copyRes.etag ?? null,
              },
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
            })) as DbSelectedFile;
          } else {
            file = (await db.file.create({
              data: {
                key: parsed.data.key,
                size: BigInt(head.size),
                contentType: ct,
                metadata: meta ?? null,
                contentHash: reservation.sha256.toLowerCase(),
                storageKey: finalStorageKey,
                etag: copyRes.etag ?? null,
                // Attribution best-effort
                createdBy: req.user?.id ?? "system",
              },
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
            })) as DbSelectedFile;
          }
        } else {
          try {
            file = (await db.file.create({
              data: {
                key: parsed.data.key,
                size: BigInt(head.size),
                contentType: ct,
                metadata: meta ?? null,
                contentHash: reservation.sha256.toLowerCase(),
                storageKey: finalStorageKey,
                etag: copyRes.etag ?? null,
                createdBy: req.user?.id ?? "system",
              },
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
            })) as DbSelectedFile;
          } catch (e) {
            const pe = e as { code?: string };
            if (pe && pe.code === "P2002") {
              res
                .status(409)
                .json({ status: "error", code: "CONFLICT", message: "Key already exists" });
              return;
            }
            throw e;
          }
        }
        // Mark reservation consumed
        await db.fileUploadReservation.update({
          where: { id: reservation.id },
          data: { consumedAt: new Date() },
        });
        res.header("ETag", copyRes.etag ?? reservation.sha256.toLowerCase());
        res.header("Location", `/files/${file.id}`);
        res.status(overwrite ? 200 : 201).json(toFileDto(asFileRecord(file)));
      } catch (e) {
        const err = e as Error & { status?: number };
        res
          .status(err.status ?? 500)
          .json({ status: "error", code: "COMMIT_FAILED", message: err.message });
      }
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
            etag: true,
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
            etag: true,
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
        if (file.etag) headers["ETag"] = file.etag;
        else if (file.contentHash) headers["ETag"] = file.contentHash;
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

  // POST /files/batch/delete
  server.post(
    "/files/batch/delete",
    requireAdminOrApiToken({
      policySignature: "POST /files/batch/delete" as RouteSignature,
      scopes: [SCOPES.FILES_WRITE],
    })(async (req, res) => {
      const B = z.object({ ids: z.array(z.string().min(1)).min(1) });
      const parsed = B.safeParse(req.body ?? {});
      if (!parsed.success) {
        res.status(400).json({ status: "error", code: "BAD_REQUEST", message: "Invalid input" });
        return;
      }
      const ids = parsed.data.ids;
      try {
        const rows: { id: string; storageKey: string | null }[] = await db.file.findMany({
          where: { id: { in: ids } },
          select: { id: true, storageKey: true },
        });
        await Promise.all(
          rows
            .map((r) => r.storageKey)
            .filter((k): k is string => typeof k === "string" && k.length > 0)
            .map((k) => storage.deleteFile(k).catch(() => void 0)),
        );
      } catch {
        // ignore storage errors
      }
      await db.file.deleteMany({ where: { id: { in: ids } } }).catch(() => void 0);
      res.status(204).json({});
    }),
  );

  // POST /files/batch/move
  server.post(
    "/files/batch/move",
    requireAdminOrApiToken({
      policySignature: "POST /files/batch/move" as RouteSignature,
      scopes: [SCOPES.FILES_WRITE],
    })(async (req, res) => {
      const B = z.object({
        items: z.array(z.object({ id: z.string().min(1), newKey: z.string().min(1) })).min(1),
      });
      const parsed = B.safeParse(req.body ?? {});
      if (!parsed.success) {
        res.status(400).json({ status: "error", code: "BAD_REQUEST", message: "Invalid input" });
        return;
      }
      const items = parsed.data.items;
      try {
        type MinimalFileModel = {
          update: (args: { where: { id: string }; data: { key: string } }) => Promise<unknown>;
        };
        type MinimalDbClient = {
          file: MinimalFileModel;
          $transaction?: (cb: (p: MinimalDbClient) => Promise<void>) => Promise<void>;
        };
        const client = db as unknown as MinimalDbClient;
        if (typeof client.$transaction === "function") {
          await client.$transaction(async (tx) => {
            for (const it of items) {
              await tx.file.update({ where: { id: it.id }, data: { key: it.newKey } });
            }
          });
        } else {
          for (const it of items) {
            await client.file.update({ where: { id: it.id }, data: { key: it.newKey } });
          }
        }
      } catch (e) {
        const pe = e as { code?: string };
        if (pe && pe.code === "P2002") {
          res
            .status(409)
            .json({ status: "error", code: "CONFLICT", message: "Key already exists" });
          return;
        }
        throw e;
      }
      res.status(204).json({});
    }),
  );
}
