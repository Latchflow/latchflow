import type { HttpServer } from "../http/http-server.js";
import { getDb } from "../db/db.js";
import { requireRecipient } from "../middleware/require-recipient.js";
import type { StorageService } from "../storage/service.js";

export function registerPortalRoutes(server: HttpServer, deps: { storage: StorageService }) {
  const db = getDb();

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
        .filter((b): b is { id: string; name: string } => Boolean(b));
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
      const assignments = await db.bundleAssignment.findMany({
        where: {
          recipientId: session.recipientId,
          isEnabled: true,
          recipient: { isEnabled: true },
          bundle: { isEnabled: true },
        },
        take: limit,
        orderBy: { updatedAt: "desc" },
        select: {
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
      res.status(200).json({ items });
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
      // Enforcement: verification
      if (assignment.verificationType && !assignment.verificationMet) {
        res
          .status(403)
          .json({
            status: "error",
            code: "VERIFICATION_REQUIRED",
            message: "Verification required",
          });
        return;
      }
      // Enforcement: maxDownloads
      const used = await db.downloadEvent.count({ where: { bundleAssignmentId: assignment.id } });
      if (assignment.maxDownloads != null && used >= assignment.maxDownloads) {
        res
          .status(403)
          .json({
            status: "error",
            code: "MAX_DOWNLOADS_EXCEEDED",
            message: "Download limit reached",
          });
        return;
      }
      // Enforcement: cooldown
      if (
        assignment.cooldownSeconds != null &&
        assignment.lastDownloadAt &&
        assignment.lastDownloadAt.getTime() + assignment.cooldownSeconds * 1000 > now.getTime()
      ) {
        res
          .status(429)
          .json({
            status: "error",
            code: "COOLDOWN_ACTIVE",
            message: "Please wait before next download",
          });
        return;
      }

      // Fetch bundle
      const bundle = await db.bundle.findUnique({ where: { id: assignment.bundleId } });
      if (!bundle || (bundle as { isEnabled?: boolean }).isEnabled === false) {
        res.status(404).json({ status: "error", code: "NOT_FOUND", message: "Bundle not found" });
        return;
      }
      if (!bundle.storagePath) {
        res
          .status(409)
          .json({
            status: "error",
            code: "NO_STORAGE_PATH",
            message: "Bundle storage not available",
          });
        return;
      }

      // Record download event & update assignment lastDownloadAt
      await db.downloadEvent.create({
        data: {
          bundleAssignmentId: assignment.id,
          downloadedAt: now,
          ip: req.ip ?? "",
          userAgent: req.userAgent ?? "",
        },
      });
      await db.bundleAssignment.update({
        where: { id: assignment.id },
        data: { lastDownloadAt: now },
      });

      // Stream bundle archive
      const headers: Record<string, string> = { "Content-Type": "application/octet-stream" };
      if (bundle.checksum) headers["ETag"] = bundle.checksum;
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
