import type { HttpServer } from "../../http/http-server.js";
import { getDb } from "../../db/db.js";
import { requirePermission } from "../../middleware/require-permission.js";

export function registerAssignmentAdminRoutes(server: HttpServer) {
  const db = getDb();

  // GET /admin/bundles/:bundleId/assignments — list assignment summaries for a bundle
  server.get(
    "/admin/bundles/:bundleId/assignments",
    requirePermission("GET /admin/bundles")(async (req, res) => {
      const params = (req.params as Record<string, string> | undefined) ?? {};
      const bundleId = params.bundleId;
      const now = new Date();
      const qp = (req.query ?? {}) as Record<string, string>;
      const limit = Math.max(1, Math.min(100, Number(qp["limit"]) || 50));

      const rows = await db.bundleAssignment.findMany({
        where: { bundleId },
        take: limit,
        orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
        select: {
          id: true,
          bundleId: true,
          recipientId: true,
          isEnabled: true,
          maxDownloads: true,
          cooldownSeconds: true,
          lastDownloadAt: true,
          bundle: { select: { id: true, name: true } },
          recipient: { select: { id: true, email: true, name: true } },
          updatedAt: true,
        },
      });
      const items = await Promise.all(
        rows.map(async (a) => {
          const used = await db.downloadEvent.count({ where: { bundleAssignmentId: a.id } });
          const remaining = a.maxDownloads != null ? Math.max(0, a.maxDownloads - used) : null;
          const nextAvailableAt =
            a.cooldownSeconds != null && a.lastDownloadAt
              ? new Date(a.lastDownloadAt.getTime() + a.cooldownSeconds * 1000)
              : null;
          const cooldownRemainingSeconds = nextAvailableAt
            ? Math.max(0, Math.ceil((nextAvailableAt.getTime() - now.getTime()) / 1000))
            : 0;
          return {
            assignmentId: a.id,
            bundleId: a.bundle?.id ?? a.bundleId,
            bundleName: a.bundle?.name ?? "",
            recipientId: a.recipientId,
            recipientEmail: a.recipient?.email ?? "",
            recipientName: a.recipient?.name ?? null,
            isEnabled: a.isEnabled,
            maxDownloads: a.maxDownloads ?? null,
            downloadsUsed: used,
            downloadsRemaining: remaining,
            cooldownSeconds: a.cooldownSeconds ?? null,
            lastDownloadAt: a.lastDownloadAt ? a.lastDownloadAt.toISOString() : null,
            nextAvailableAt: nextAvailableAt ? nextAvailableAt.toISOString() : null,
            cooldownRemainingSeconds,
          };
        }),
      );
      res.status(200).json({ items });
    }),
  );

  // GET /admin/recipients/:recipientId/assignments — list assignment summaries for a recipient
  server.get(
    "/admin/recipients/:recipientId/assignments",
    requirePermission("GET /admin/recipients")(async (req, res) => {
      const params = (req.params as Record<string, string> | undefined) ?? {};
      const recipientId = params.recipientId;
      const now = new Date();
      const qp = (req.query ?? {}) as Record<string, string>;
      const limit = Math.max(1, Math.min(100, Number(qp["limit"]) || 50));

      const rows = await db.bundleAssignment.findMany({
        where: { recipientId },
        take: limit,
        orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
        select: {
          id: true,
          bundleId: true,
          recipientId: true,
          isEnabled: true,
          maxDownloads: true,
          cooldownSeconds: true,
          lastDownloadAt: true,
          bundle: { select: { id: true, name: true } },
          recipient: { select: { id: true, email: true, name: true } },
          updatedAt: true,
        },
      });
      const items = await Promise.all(
        rows.map(async (a) => {
          const used = await db.downloadEvent.count({ where: { bundleAssignmentId: a.id } });
          const remaining = a.maxDownloads != null ? Math.max(0, a.maxDownloads - used) : null;
          const nextAvailableAt =
            a.cooldownSeconds != null && a.lastDownloadAt
              ? new Date(a.lastDownloadAt.getTime() + a.cooldownSeconds * 1000)
              : null;
          const cooldownRemainingSeconds = nextAvailableAt
            ? Math.max(0, Math.ceil((nextAvailableAt.getTime() - now.getTime()) / 1000))
            : 0;
          return {
            assignmentId: a.id,
            bundleId: a.bundle?.id ?? a.bundleId,
            bundleName: a.bundle?.name ?? "",
            recipientId: a.recipientId,
            recipientEmail: a.recipient?.email ?? "",
            recipientName: a.recipient?.name ?? null,
            isEnabled: a.isEnabled,
            maxDownloads: a.maxDownloads ?? null,
            downloadsUsed: used,
            downloadsRemaining: remaining,
            cooldownSeconds: a.cooldownSeconds ?? null,
            lastDownloadAt: a.lastDownloadAt ? a.lastDownloadAt.toISOString() : null,
            nextAvailableAt: nextAvailableAt ? nextAvailableAt.toISOString() : null,
            cooldownRemainingSeconds,
          };
        }),
      );
      res.status(200).json({ items });
    }),
  );
}
