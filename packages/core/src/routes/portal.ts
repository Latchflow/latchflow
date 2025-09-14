import type { HttpServer } from "../http/http-server.js";
import { getDb } from "../db/db.js";
import { requireRecipient } from "../middleware/require-recipient.js";
import type { StorageService } from "../storage/service.js";
import type { Prisma } from "@latchflow/db";

export function registerPortalRoutes(server: HttpServer, deps: { storage: StorageService }) {
  const db = getDb();

  // Minimal DB surface used inside the transactional download path
  type AssignmentRow = {
    isEnabled?: boolean;
    lastDownloadAt?: Date | null;
    cooldownSeconds?: number | null;
    maxDownloads?: number | null;
  };
  async function runInTx<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    const candidate = db as unknown as {
      $transaction?: <R>(cb: (tx: unknown) => Promise<R>) => Promise<R>;
    };
    if (typeof candidate.$transaction === "function") {
      return candidate.$transaction((tx: unknown) => fn(tx as Prisma.TransactionClient));
    }
    // Fallback for test mocks without $transaction
    return fn(db as unknown as Prisma.TransactionClient);
  }

  // GET /portal/me
  server.get("/portal/me", async (req, res) => {
    try {
      const { session, recipient } = await requireRecipient(req, false);
      const assignments = await db.bundleAssignment.findMany({
        where: {
          recipientId: session.recipientId,
          isEnabled: true,
          recipient: { isEnabled: true },
          bundle: { isEnabled: true },
        },
        select: { bundle: { select: { id: true, name: true } } },
      });
      const bundles = assignments
        .map((a) => a.bundle)
        .filter((b): b is { id: string; name: string } => Boolean(b))
        .map((b) => ({ bundleId: b.id, name: b.name }));
      res.status(200).json({ recipient, bundles });
    } catch (e) {
      const err = e as Error & { status?: number };
      res
        .status(err.status ?? 401)
        .json({ status: "error", code: "UNAUTHORIZED", message: err.message });
    }
  });

  // GET /portal/bundles
  server.get("/portal/bundles", async (req, res) => {
    try {
      const { session } = await requireRecipient(req, false);
      const qp = (req.query ?? {}) as Record<string, string>;
      const limit = Math.max(1, Math.min(100, Number(qp["limit"]) || 50));
      const rawCursor = qp["cursor"];
      let after: { updatedAt: string; id: string } | null = null;
      if (rawCursor && typeof rawCursor === "string") {
        try {
          const decoded = Buffer.from(rawCursor, "base64").toString("utf8");
          const obj = JSON.parse(decoded);
          if (obj && typeof obj.updatedAt === "string" && typeof obj.id === "string") {
            after = { updatedAt: obj.updatedAt, id: obj.id };
          }
        } catch {
          // ignore bad cursor
        }
      }
      const whereBase = {
        recipientId: session.recipientId,
        isEnabled: true,
        recipient: { isEnabled: true },
        bundle: { isEnabled: true },
      } as const;
      const where = after
        ? {
            AND: [
              whereBase,
              {
                OR: [
                  { updatedAt: { lt: new Date(after.updatedAt) } },
                  { AND: [{ updatedAt: new Date(after.updatedAt) }, { id: { lt: after.id } }] },
                ],
              },
            ],
          }
        : whereBase;
      type FindManyArgs = NonNullable<Parameters<typeof db.bundleAssignment.findMany>[0]>;
      const assignments = await db.bundleAssignment.findMany({
        where: where as FindManyArgs["where"],
        take: limit,
        orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
        select: {
          id: true,
          updatedAt: true,
          bundle: {
            select: {
              id: true,
              name: true,
              storagePath: true,
              checksum: true,
              description: true,
              createdAt: true,
              updatedAt: true,
            },
          },
        },
      });
      const items = assignments.map((a) => a.bundle).filter(Boolean);
      const last = assignments[assignments.length - 1] as
        | { updatedAt?: Date; id?: string }
        | undefined;
      const nextCursor =
        last?.updatedAt && last?.id
          ? Buffer.from(
              JSON.stringify({ updatedAt: last.updatedAt.toISOString(), id: last.id }),
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
  });

  // GET /portal/bundles/:bundleId/objects
  server.get("/portal/bundles/:bundleId/objects", async (req, res) => {
    try {
      const { assignment } = await requireRecipient(req, true);
      // assignment exists and is enabled; list enabled bundle objects
      const objects = await db.bundleObject.findMany({
        where: { bundleId: assignment.bundleId, isEnabled: true },
        orderBy: { sortOrder: "asc" },
        select: { file: true },
      });
      const items = objects.map((o) => o.file).filter(Boolean);
      res.status(200).json({ items });
    } catch (e) {
      const err = e as Error & { status?: number };
      res
        .status(err.status ?? 401)
        .json({ status: "error", code: "UNAUTHORIZED", message: err.message });
    }
  });

  // GET /portal/bundles/:bundleId (download)
  server.get("/portal/bundles/:bundleId", async (req, res) => {
    try {
      const { assignment } = await requireRecipient(req, true);
      const now = new Date();
      // Atomic enforcement + event insert (before fetching bundle)
      try {
        await runInTx(async (tx) => {
          const fresh = await tx.bundleAssignment.findUnique({ where: { id: assignment.id } });
          const current: AssignmentRow | null = fresh ?? {
            isEnabled: true,
            lastDownloadAt: assignment.lastDownloadAt ?? null,
            cooldownSeconds: assignment.cooldownSeconds ?? null,
            maxDownloads: assignment.maxDownloads ?? null,
          };
          if (!current || current.isEnabled === false) {
            throw Object.assign(new Error("Not authorized"), { status: 403 });
          }
          const used = await tx.downloadEvent.count({
            where: { bundleAssignmentId: assignment.id },
          });
          if (current.maxDownloads != null && used >= current.maxDownloads) {
            throw Object.assign(new Error("Download limit reached"), {
              status: 403,
              code: "MAX_DOWNLOADS_EXCEEDED",
            });
          }
          if (
            current.cooldownSeconds != null &&
            current.lastDownloadAt &&
            current.lastDownloadAt.getTime() + current.cooldownSeconds * 1000 > now.getTime()
          ) {
            throw Object.assign(new Error("Please wait before next download"), {
              status: 429,
              code: "COOLDOWN_ACTIVE",
            });
          }
          await tx.downloadEvent.create({
            data: {
              bundleAssignmentId: assignment.id,
              downloadedAt: now,
              ip: req.ip ?? "",
              userAgent: req.userAgent ?? "",
            },
          });
          await tx.bundleAssignment.update({
            where: { id: assignment.id },
            data: { lastDownloadAt: now },
          });
        });
      } catch (err) {
        const ee = err as Error & { status?: number; code?: string };
        const status = ee.status ?? 409;
        const code = ee.code ?? (status === 429 ? "COOLDOWN_ACTIVE" : "MAX_DOWNLOADS_EXCEEDED");
        res.status(status).json({ status: "error", code, message: ee.message });
        return;
      }
      // Fetch bundle after enforcement
      const bundle = await db.bundle.findUnique({ where: { id: assignment.bundleId } });
      if (!bundle || (bundle as { isEnabled?: boolean }).isEnabled === false) {
        res.status(404).json({ status: "error", code: "NOT_FOUND", message: "Bundle not found" });
        return;
      }
      if (!bundle.storagePath) {
        res.status(409).json({
          status: "error",
          code: "NO_STORAGE_PATH",
          message: "Bundle storage not available",
        });
        return;
      }
      // Stream bundle archive (prefer storage-native ETag)
      const headers: Record<string, string> = { "Content-Type": "application/octet-stream" };
      try {
        const head = (await deps.storage.headFile(bundle.storagePath)) as { etag?: unknown };
        if (typeof head?.etag === "string" || typeof head?.etag === "number") {
          headers["ETag"] = String(head.etag);
        }
      } catch {
        if (bundle.checksum) headers["ETag"] = bundle.checksum;
      }
      const stream = await deps.storage.getFileStream(bundle.storagePath);
      res.sendStream(stream, headers);
    } catch (e) {
      const err = e as Error & { status?: number };
      res
        .status(err.status ?? 401)
        .json({ status: "error", code: "UNAUTHORIZED", message: err.message });
    }
  });
}
