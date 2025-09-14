import type { DbClient } from "../db/db.js";
import type { StorageService } from "../storage/service.js";
import { buildBundleArtifact } from "./builder.js";

export type BundleRebuildScheduler = ReturnType<typeof createBundleRebuildScheduler>;

export function createBundleRebuildScheduler(deps: {
  db: DbClient;
  storage: StorageService;
  debounceMs?: number;
}) {
  const db = deps.db;
  const storage = deps.storage;
  const debounceMs = typeof deps.debounceMs === "number" ? deps.debounceMs : 2000;
  const timers = new Map<string, NodeJS.Timeout>();
  const running = new Set<string>();
  const queued = new Set<string>();
  const forceFlags = new Set<string>();
  const last: Record<string, { when: Date; status: "built" | "skipped"; error?: string }> = {};

  async function run(bundleId: string) {
    if (running.has(bundleId)) {
      queued.add(bundleId);
      return;
    }
    running.add(bundleId);
    try {
      const force = forceFlags.has(bundleId);
      forceFlags.delete(bundleId);
      const res = await buildBundleArtifact(db, storage, bundleId, { force }).catch((e: Error) => {
        last[bundleId] = { when: new Date(), status: "skipped", error: e.message };
        return null;
      });
      if (res) {
        if (res.status === "built") last[bundleId] = { when: new Date(), status: "built" };
        else last[bundleId] = { when: new Date(), status: "skipped" };
      }
    } finally {
      running.delete(bundleId);
      if (queued.has(bundleId)) {
        queued.delete(bundleId);
        schedule(bundleId);
      }
    }
  }

  function schedule(bundleId: string, opts?: { force?: boolean }) {
    // Debounce per bundle
    const existing = timers.get(bundleId);
    if (existing) clearTimeout(existing);
    if (opts?.force) forceFlags.add(bundleId);
    const t = setTimeout(() => {
      timers.delete(bundleId);
      void run(bundleId);
    }, debounceMs);
    timers.set(bundleId, t);
  }

  async function scheduleForFiles(fileIds: string[], opts?: { force?: boolean }) {
    if (fileIds.length === 0) return;
    const bos = await db.bundleObject.findMany({
      where: { fileId: { in: fileIds } },
      select: { bundleId: true },
    });
    const bundleIds = Array.from(new Set(bos.map((x) => x.bundleId))).filter(Boolean);
    for (const bid of bundleIds) schedule(bid, opts);
  }

  function getStatus(bundleId: string): {
    state: "idle" | "queued" | "running";
    last?: { when: string; status: "built" | "skipped"; error?: string };
  } {
    const state = running.has(bundleId) ? "running" : timers.has(bundleId) ? "queued" : "idle";
    const l = last[bundleId];
    return {
      state,
      ...(l
        ? {
            last: {
              when: l.when.toISOString(),
              status: l.status,
              ...(l.error ? { error: l.error } : {}),
            },
          }
        : {}),
    };
  }

  return {
    schedule,
    scheduleForFiles,
    getStatus,
  };
}
