import { createHash } from "node:crypto";
import type { Compiled, CompiledRule, Permission } from "./types.js";

export type CompiledPermissions = {
  rulesHash: string;
  compiled: Compiled;
  rules: CompiledRule[];
};

export function compilePermissions(permissions: Permission[], fallbackHash?: string): CompiledPermissions {
  const compiled: Compiled = Object.create(null);
  const rules: CompiledRule[] = [];
  const canonicalSource: Permission[] = [];
  let hadError = false;
  permissions.forEach((perm, index) => {
    if (!perm || typeof perm !== "object") return;
    try {
      const resource = perm.resource ?? "*";
      const action = perm.action;
      if (!action) return;
      const whereValue = sanitizeValue(safeAccess(() => perm.where));
      const inputValue = sanitizeValue(safeAccess(() => perm.input));
      const rule: CompiledRule = {
        id: perm.id ?? `${resource}:${action}:${index}`,
        source: perm.source,
        where: whereValue,
        input: inputValue,
        raw: perm,
      };
      const resourceBucket = (compiled[resource] ??= Object.create(null) as Record<string, CompiledRule[]>);
      const actionBucket = (resourceBucket[action] ??= []);
      actionBucket.push(rule);
      if (resource !== "*") {
        const wildcard = (compiled["*"] ??= Object.create(null) as Record<string, CompiledRule[]>);
        const wildcardBucket = (wildcard[action] ??= []);
        wildcardBucket.push(rule);
      }
      rules.push(rule);
      canonicalSource.push({
        id: rule.id,
        source: rule.source,
        action,
        resource,
        where: whereValue as Permission["where"],
        input: inputValue as Permission["input"],
      });
    } catch {
      // Skip malformed rule
      hadError = true;
    }
  });
  const rulesHash = hadError && fallbackHash
    ? fallbackHash
    : computeRulesHash(canonicalSource, fallbackHash);
  return { compiled, rules, rulesHash };
}

export function computeRulesHash(permissions: Permission[], fallback?: string): string {
  try {
    const canonical = canonicalizePermissions(permissions);
    const hash = createHash("sha256");
    hash.update(JSON.stringify(canonical));
    return hash.digest("hex");
  } catch {
    if (fallback) return fallback;
    const hash = createHash("sha256");
    hash.update(`${Date.now()}-${Math.random()}`);
    return hash.digest("hex");
  }
}

function canonicalizePermissions(permissions: Permission[]) {
  return permissions.map((perm, index) => canonicalizePermission(perm, index));
}

function canonicalizePermission(perm: Permission, index: number) {
  const where = sanitizeValue(safeAccess(() => perm.where));
  const input = sanitizeValue(safeAccess(() => perm.input));
  const canonicalWhere = where ? safeAccess(() => sortValue(where)) : null;
  const canonicalInput = input ? safeAccess(() => sortValue(input)) : null;
  return sortValue({
    idx: index,
    id: perm.id ?? null,
    source: perm.source ?? null,
    action: perm.action,
    resource: perm.resource,
    where: canonicalWhere ?? null,
    input: canonicalInput ?? null,
  });
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortValue).sort(compareValues);
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .map(([k, v]) => [k, sortValue(v)] as const)
      .sort(([a], [b]) => a.localeCompare(b));
    return Object.fromEntries(entries);
  }
  return value;
}

function compareValues(a: unknown, b: unknown): number {
  const sa = JSON.stringify(a);
  const sb = JSON.stringify(b);
  return sa.localeCompare(sb);
}

function safeAccess<T>(fn: () => T): T | undefined {
  try {
    return fn();
  } catch {
    return undefined;
  }
}

function sanitizeValue<T>(value: T | undefined): T | undefined {
  if (value == null) return undefined;
  return sanitizeRecursive(value) as T;
}

function sanitizeRecursive(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sanitizeRecursive);
  }
  if (value && typeof value === "object") {
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const result: Record<string, unknown> = {};
    for (const [key, descriptor] of Object.entries(descriptors)) {
      if (!descriptor || !("value" in descriptor)) continue;
      result[key] = sanitizeRecursive(descriptor.value);
    }
    return result;
  }
  return value;
}
