import { z } from "zod";
import type { HttpServer } from "../../http/http-server.js";
import { getDb } from "../../db/db.js";
import { requirePermission } from "../../middleware/require-permission.js";
import type { StorageService } from "../../storage/service.js";
import type { BundleRebuildScheduler } from "../../bundles/scheduler.js";

export function registerBundleBuildAdminRoutes(
  server: HttpServer,
  deps: { storage: StorageService; scheduler: BundleRebuildScheduler },
) {
  const db = getDb();

  // POST /admin/bundles/:bundleId/build — trigger a build immediately
  server.post(
    "/admin/bundles/:bundleId/build",
    requirePermission("POST /admin/bundles/:bundleId/build")(async (req, res) => {
      try {
        const P = z.object({ bundleId: z.string().min(1) });
        const B = z.object({ force: z.coerce.boolean().optional() }).optional();
        const pp = P.safeParse((req.params ?? {}) as Record<string, unknown>);
        const bb = B.safeParse((req.body ?? {}) as Record<string, unknown>);
        if (!pp.success) {
          res.status(400).json({ status: "error", code: "BAD_REQUEST", message: "Invalid params" });
          return;
        }
        const bundle = await db.bundle.findUnique({ where: { id: pp.data.bundleId } });
        if (!bundle) {
          res.status(404).json({ status: "error", code: "NOT_FOUND", message: "Bundle not found" });
          return;
        }
        const force = Boolean(bb.success ? bb.data?.force : false);
        await deps.scheduler.schedule(pp.data.bundleId, { force });
        res.status(202).json({ status: "queued" });
      } catch (e) {
        const err = e as Error & { status?: number };
        res
          .status(err.status ?? 500)
          .json({ status: "error", code: "BUILD_FAILED", message: err.message });
      }
    }),
  );

  // GET /admin/bundles/:bundleId/build/status — return current digest/pointers
  server.get(
    "/admin/bundles/:bundleId/build/status",
    requirePermission("GET /admin/bundles/:bundleId/build/status")(async (req, res) => {
      try {
        const P = z.object({ bundleId: z.string().min(1) });
        const pp = P.safeParse((req.params ?? {}) as Record<string, unknown>);
        if (!pp.success) {
          res.status(400).json({ status: "error", code: "BAD_REQUEST", message: "Invalid params" });
          return;
        }
        const b = await db.bundle.findUnique({
          where: { id: pp.data.bundleId },
          select: {
            id: true,
            bundleDigest: true,
            storagePath: true,
            checksum: true,
            updatedAt: true,
          },
        });
        if (!b) {
          res.status(404).json({ status: "error", code: "NOT_FOUND", message: "Bundle not found" });
          return;
        }
        const s = deps.scheduler.getStatus(pp.data.bundleId);
        res.status(200).json({
          status: s.state,
          bundleId: b.id,
          bundleDigest: b.bundleDigest,
          storagePath: b.storagePath,
          checksum: b.checksum,
          updatedAt: b.updatedAt?.toISOString?.() ?? null,
          ...(s.last ? { last: s.last } : {}),
        });
      } catch (e) {
        const err = e as Error & { status?: number };
        res
          .status(err.status ?? 500)
          .json({ status: "error", code: "STATUS_FAILED", message: err.message });
      }
    }),
  );
}
