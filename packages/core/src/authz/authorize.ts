import type { RequestLike } from "../http/http-server.js";
import type { AuthzEvaluationMode } from "../observability/metrics.js";
import type { AuthzContext } from "./context.js";
import { evaluateInputGuards } from "./inputGuards.js";
import { getOrCompilePermissions } from "./cache.js";
import type {
  AuthorizeDecision,
  CompiledRule,
  ExecAction,
  ExecResource,
  Permission,
  PolicyEntry,
} from "./types.js";

export type AuthorizeParams = {
  entry?: PolicyEntry;
  signature?: string;
  req: RequestLike;
  context: AuthzContext;
  user: UserWithPermissions;
  evaluationMode: AuthzEvaluationMode;
  systemUserId: string;
  now?: Date;
};

export type AuthorizationResult = {
  decision: AuthorizeDecision;
  rulesHash: string;
  matchedRule?: CompiledRule;
  presetId?: string;
  presetVersion?: number;
};

type UserWithPermissions = {
  id: string;
  role?: string | null;
  isActive?: boolean | null;
  permissionsHash?: string | null;
  directPermissions?: unknown;
  permissionPresetId?: string | null;
  permissionPreset?: { id: string; version?: number | null; rules?: unknown } | null;
};

export function authorizeRequest(params: AuthorizeParams): AuthorizationResult {
  const { entry, context, user, req, evaluationMode, systemUserId } = params;
  const now = params.now ?? new Date();
  if (!entry) {
    return { decision: { ok: false, reason: "NO_POLICY" }, rulesHash: user.permissionsHash ?? "" };
  }
  if (!context.isActive) {
    return { decision: { ok: false, reason: "INACTIVE" }, rulesHash: user.permissionsHash ?? "" };
  }

  if (context.role === "ADMIN") {
    return {
      decision: { ok: true, reason: "ADMIN" },
      rulesHash: user.permissionsHash ?? "",
    };
  }

  const presetRules = normalizeRules(user.permissionPreset?.rules, "preset");
  const directRules = normalizeRules(user.directPermissions, "direct");
  const allRules = [...presetRules, ...directRules];
  const compiled = getOrCompilePermissions(allRules, user.permissionsHash ?? undefined);
  const resourceBuckets = gatherBuckets(compiled.compiled, entry.resource, entry.action);

  let whereMiss = false;
  let lastInputFailure: AuthorizeDecision["reason"] | null = null;

  for (const rule of resourceBuckets) {
    if (!matchesWhere(rule.where, req, context, systemUserId, now)) {
      whereMiss = true;
      continue;
    }
    const guardResult = evaluateInputGuards(rule.input, req, {
      evaluationMode,
      ruleId: rule.id,
      userId: user.id,
      rulesHash: compiled.rulesHash,
      now,
    });
    if (!guardResult.ok) {
      if (guardResult.code === "RATE_LIMIT") {
        return {
          decision: { ok: false, reason: "RATE_LIMIT" },
          rulesHash: compiled.rulesHash,
        };
      }
      lastInputFailure = "INPUT_GUARD";
      continue;
    }
    return {
      decision: {
        ok: true,
        reason: "RULE_MATCH",
        matchedRule: rule,
        presetId: rule.source === "preset" ? (user.permissionPreset?.id ?? undefined) : undefined,
        presetVersion:
          rule.source === "preset" ? (user.permissionPreset?.version ?? undefined) : undefined,
      },
      rulesHash: compiled.rulesHash,
      matchedRule: rule,
      presetId: rule.source === "preset" ? (user.permissionPreset?.id ?? undefined) : undefined,
      presetVersion:
        rule.source === "preset" ? (user.permissionPreset?.version ?? undefined) : undefined,
    };
  }

  if (lastInputFailure) {
    return { decision: { ok: false, reason: lastInputFailure }, rulesHash: compiled.rulesHash };
  }
  if (whereMiss) {
    return { decision: { ok: false, reason: "WHERE_MISS" }, rulesHash: compiled.rulesHash };
  }
  return { decision: { ok: false, reason: "NO_MATCH" }, rulesHash: compiled.rulesHash };
}

function normalizeRules(rules: unknown, source: Permission["source"]): Permission[] {
  if (!Array.isArray(rules)) return [];
  return rules
    .filter((rule): rule is Permission => typeof rule === "object" && rule !== null)
    .map((rule, index) => ({ ...rule, id: rule.id ?? `${source ?? "unknown"}:${index}`, source }))
    .filter((rule) => Boolean(rule.action && rule.resource));
}

function gatherBuckets(
  compiled: ReturnType<typeof getOrCompilePermissions>["compiled"],
  resource: ExecResource,
  action: ExecAction,
): CompiledRule[] {
  const buckets: CompiledRule[] = [];
  const specific = compiled[resource]?.[action];
  if (specific) buckets.push(...specific);
  const wildcardResource = compiled["*"]?.[action];
  if (wildcardResource) buckets.push(...wildcardResource);
  return buckets;
}

function matchesWhere(
  where: NonNullable<Permission["where"]> | undefined,
  req: RequestLike,
  context: AuthzContext,
  systemUserId: string,
  now: Date,
): boolean {
  if (!where) return true;
  if (
    where.bundleIds &&
    !listIncludes(where.bundleIds, collectIds(context.ids.bundleId, req, ["bundleId", "bundle.id"]))
  ) {
    return false;
  }
  if (
    where.pipelineIds &&
    !listIncludes(
      where.pipelineIds,
      collectIds(context.ids.pipelineId, req, ["pipelineId", "pipeline.id"]),
    )
  ) {
    return false;
  }
  if (
    where.triggerKinds &&
    !listIncludes(where.triggerKinds, collectValues(req, ["body.kind", "body.trigger.kind"]))
  ) {
    return false;
  }
  if (
    where.actionKinds &&
    !listIncludes(where.actionKinds, collectValues(req, ["body.kind", "body.action.kind"]))
  ) {
    return false;
  }
  if (
    where.recipientTagsAny &&
    !arraysIntersect(
      where.recipientTagsAny,
      collectArrayValues(req, ["body.tags", "body.recipient.tags"]),
    )
  ) {
    return false;
  }
  if (
    where.environments &&
    !listIncludes(
      where.environments,
      collectValues(req, [
        "query.environment",
        "body.environment",
        "headers.x-latchflow-environment",
      ]),
    )
  ) {
    return false;
  }
  if (where.systemOnly && context.userId !== systemUserId) {
    return false;
  }
  if (
    where.ownerIsSelf &&
    !listIncludes(
      [context.userId],
      collectIds(undefined, req, ["params.userId", "body.userId", "body.ownerId", "query.userId"]),
    )
  ) {
    return false;
  }
  if (where.timeWindow) {
    const since = where.timeWindow.since ? new Date(where.timeWindow.since) : null;
    const until = where.timeWindow.until ? new Date(where.timeWindow.until) : null;
    if (since && now < since) return false;
    if (until && now > until) return false;
  }
  return true;
}

function collectIds(primary: string | undefined, req: RequestLike, paths: string[]): string[] {
  const values = new Set<string>();
  if (primary) values.add(primary);
  for (const path of paths) {
    const value = getByPath(req, path);
    if (typeof value === "string" && value.length) values.add(value);
  }
  return [...values];
}

function collectValues(req: RequestLike, paths: string[]): string[] {
  const values = new Set<string>();
  for (const path of paths) {
    const value = getByPath(req, path);
    if (typeof value === "string" && value.length) values.add(value);
  }
  return [...values];
}

function collectArrayValues(req: RequestLike, paths: string[]): string[] {
  const values = new Set<string>();
  for (const path of paths) {
    const value = getByPath(req, path);
    if (Array.isArray(value)) {
      for (const item of value) {
        if (typeof item === "string") values.add(item);
      }
    }
  }
  return [...values];
}

function listIncludes(candidates: string[], values: string[]): boolean {
  if (!candidates.length || !values.length) return false;
  return values.some((value) => candidates.includes(value));
}

function arraysIntersect(a: string[], b: string[]): boolean {
  if (!a.length || !b.length) return false;
  return a.some((value) => b.includes(value));
}

function getByPath(obj: RequestLike, path: string): unknown {
  const segments = path.split(".");
  let current: unknown = obj;
  for (const segment of segments) {
    if (!current) return undefined;
    if (typeof current !== "object") return undefined;
    const record = current as Record<string, unknown>;
    current = record[segment];
  }
  return current;
}
