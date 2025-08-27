import type { DbClient } from "../db/db.js";

export type EntityType =
  | "PIPELINE"
  | "BUNDLE"
  | "RECIPIENT"
  | "TRIGGER_DEFINITION"
  | "ACTION_DEFINITION";

export type Canonical = Record<string, unknown>;

function sortBy<T>(arr: T[], keyGet: (x: T) => string | number): T[] {
  return [...arr].sort((a, b) => {
    const ka = keyGet(a);
    const kb = keyGet(b);
    if (ka < kb) return -1;
    if (ka > kb) return 1;
    return 0;
  });
}

export async function serializeAggregate(
  db: DbClient,
  entityType: EntityType,
  id: string,
): Promise<Canonical | null> {
  if (entityType === "PIPELINE") {
    const pl = await db.pipeline.findUnique({
      where: { id },
      include: {
        steps: true,
        triggers: true,
      },
    });
    if (!pl) return null;
    const steps = sortBy(pl.steps, (s) => `${s.sortOrder.toString().padStart(9, "0")}|${s.id}`).map(
      (s) => ({
        id: s.id,
        actionId: s.actionId,
        sortOrder: s.sortOrder,
        isEnabled: s.isEnabled,
      }),
    );
    const triggers = sortBy(
      pl.triggers,
      (t) => `${t.sortOrder.toString().padStart(9, "0")}|${t.triggerId}`,
    ).map((t) => ({
      triggerId: t.triggerId,
      sortOrder: t.sortOrder,
      isEnabled: t.isEnabled,
    }));
    return {
      id: pl.id,
      name: pl.name,
      description: pl.description ?? null,
      isEnabled: pl.isEnabled,
      steps,
      triggers,
      createdBy: pl.createdBy,
      updatedBy: pl.updatedBy ?? null,
    };
  }
  if (entityType === "BUNDLE") {
    const b = await db.bundle.findUnique({
      where: { id },
      include: {
        bundleObjects: true,
        assignments: true,
      },
    });
    if (!b) return null;
    const objects = sortBy(
      b.bundleObjects,
      (o) => `${o.sortOrder.toString().padStart(9, "0")}|${o.id}`,
    ).map((o) => ({
      id: o.id,
      fileId: o.fileId,
      path: o.path ?? null,
      required: o.required,
      notes: o.notes ?? null,
      sortOrder: o.sortOrder,
    }));
    const assignments = sortBy(b.assignments, (a) => a.id).map((a) => ({
      id: a.id,
      recipientId: a.recipientId,
      maxDownloads: a.maxDownloads ?? null,
      cooldownSeconds: a.cooldownSeconds ?? null,
      verificationType: a.verificationType ?? null,
    }));
    return {
      id: b.id,
      name: b.name,
      objects,
      assignments,
      policy: {},
      createdBy: b.createdBy,
      updatedBy: b.updatedBy ?? null,
    };
  }
  if (entityType === "RECIPIENT") {
    const r = await db.recipient.findUnique({ where: { id } });
    if (!r) return null;
    return {
      id: r.id,
      email: r.email,
      name: r.name ?? null,
      createdBy: r.createdBy,
      updatedBy: r.updatedBy ?? null,
    };
  }
  if (entityType === "TRIGGER_DEFINITION") {
    const t = await db.triggerDefinition.findUnique({ where: { id } });
    if (!t) return null;
    return {
      id: t.id,
      name: t.name,
      capabilityId: t.capabilityId,
      config: redactConfig(t.config),
      isEnabled: t.isEnabled,
      createdBy: t.createdBy,
      updatedBy: t.updatedBy ?? null,
    };
  }
  if (entityType === "ACTION_DEFINITION") {
    const a = await db.actionDefinition.findUnique({ where: { id } });
    if (!a) return null;
    return {
      id: a.id,
      name: a.name,
      capabilityId: a.capabilityId,
      config: redactConfig(a.config),
      isEnabled: a.isEnabled,
      createdBy: a.createdBy,
      updatedBy: a.updatedBy ?? null,
    };
  }
  return null;
}

function redactConfig(config: unknown): unknown {
  if (!config || typeof config !== "object") return config;
  try {
    const cloned = JSON.parse(JSON.stringify(config)) as unknown;
    const redactKeys = new Set([
      "password",
      "secret",
      "token",
      "apiKey",
      "credentials",
      "accessKey",
      "secretKey",
    ]);
    const walk = (node: unknown): void => {
      if (Array.isArray(node)) {
        for (const item of node) walk(item);
        return;
      }
      if (!node || typeof node !== "object") return;
      const obj = node as Record<string, unknown>;
      for (const k of Object.keys(obj)) {
        const v = obj[k];
        if (redactKeys.has(k)) {
          obj[k] = { secretRef: `cfg:${k}` } as unknown;
        } else {
          walk(v);
        }
      }
    };
    walk(cloned);
    return cloned;
  } catch {
    return null;
  }
}

function deepSortUnknown(obj: unknown, seen: WeakSet<object>): unknown {
  if (obj === null || typeof obj !== "object") return obj;
  if (Array.isArray(obj)) return obj.map((x) => deepSortUnknown(x, seen));
  const asObj = obj as Record<string, unknown>;
  if (seen.has(asObj)) return null;
  seen.add(asObj);
  const keys = Object.keys(asObj).sort();
  const out: Record<string, unknown> = {};
  for (const k of keys) out[k] = deepSortUnknown(asObj[k], seen);
  return out;
}

export function canonicalStringify(obj: unknown): string {
  const seen = new WeakSet<object>();
  return JSON.stringify(deepSortUnknown(obj, seen));
}
