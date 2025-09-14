import type { HttpServer } from "../../http/http-server.js";
import { getDb } from "../../db/db.js";
import { requirePermission } from "../../middleware/require-permission.js";
import { toAssignmentSummary, type AssignmentRowForSummary } from "../../dto/assignment.js";

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
          _count: { select: { downloadEvents: true } },
        },
      });
      const items = await Promise.all(
        rows.map(async (a) => {
          const fromCount = (a as unknown as { _count?: { downloadEvents?: number } })._count
            ?.downloadEvents;
          const used =
            typeof fromCount === "number"
              ? fromCount
              : await db.downloadEvent.count({ where: { bundleAssignmentId: a.id } });
          const summary = toAssignmentSummary(a as AssignmentRowForSummary, used, now);
          return {
            assignmentId: a.id,
            bundleId: summary.bundleId,
            bundleName: summary.name,
            recipientId: a.recipientId,
            recipientEmail: a.recipient?.email ?? "",
            recipientName: a.recipient?.name ?? null,
            isEnabled: a.isEnabled,
            maxDownloads: summary.maxDownloads,
            downloadsUsed: summary.downloadsUsed,
            downloadsRemaining: summary.downloadsRemaining,
            cooldownSeconds: summary.cooldownSeconds,
            lastDownloadAt: summary.lastDownloadAt,
            nextAvailableAt: summary.nextAvailableAt,
            cooldownRemainingSeconds: summary.cooldownRemainingSeconds,
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
          _count: { select: { downloadEvents: true } },
        },
      });
      const items = await Promise.all(
        rows.map(async (a) => {
          const fromCount = (a as unknown as { _count?: { downloadEvents?: number } })._count
            ?.downloadEvents;
          const used =
            typeof fromCount === "number"
              ? fromCount
              : await db.downloadEvent.count({ where: { bundleAssignmentId: a.id } });
          const summary = toAssignmentSummary(a as AssignmentRowForSummary, used, now);
          return {
            assignmentId: a.id,
            bundleId: summary.bundleId,
            bundleName: summary.name,
            recipientId: a.recipientId,
            recipientEmail: a.recipient?.email ?? "",
            recipientName: a.recipient?.name ?? null,
            isEnabled: a.isEnabled,
            maxDownloads: summary.maxDownloads,
            downloadsUsed: summary.downloadsUsed,
            downloadsRemaining: summary.downloadsRemaining,
            cooldownSeconds: summary.cooldownSeconds,
            lastDownloadAt: summary.lastDownloadAt,
            nextAvailableAt: summary.nextAvailableAt,
            cooldownRemainingSeconds: summary.cooldownRemainingSeconds,
          };
        }),
      );
      res.status(200).json({ items });
    }),
  );
}
