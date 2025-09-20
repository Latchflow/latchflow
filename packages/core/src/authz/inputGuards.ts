import type { RequestLike } from "../http/http-server.js";
import type { AuthzEvaluationMode } from "../observability/metrics.js";
import type { Permission } from "./types.js";

export type InputGuardEvaluation =
  | { ok: true }
  | { ok: false; code: "ALLOWED_PARAMS" | "DENIED_PARAM" | "VALUE_RULE" | "DRY_RUN_ONLY" | "RATE_LIMIT"; message: string };

export type InputGuardContext = {
  userId?: string;
  ruleId?: string;
  rulesHash?: string;
  evaluationMode: AuthzEvaluationMode;
  now?: Date;
};

const rateLimitState = new Map<string, number[]>();

export function evaluateInputGuards(
  guards: Permission["input"],
  req: RequestLike,
  context: InputGuardContext,
): InputGuardEvaluation {
  if (!guards) return { ok: true };
  const body = isPlainObject(req.body) ? (req.body as Record<string, unknown>) : undefined;
  const query = isPlainObject(req.query) ? (req.query as Record<string, unknown>) : undefined;

  if (guards.allowParams && body) {
    const extra = Object.keys(body).filter((key) => !guards.allowParams!.includes(key));
    if (extra.length > 0) {
      return { ok: false, code: "ALLOWED_PARAMS", message: `Unexpected parameter(s): ${extra.join(", ")}` };
    }
  }

  if (guards.denyParams && body) {
    const denied = guards.denyParams.find((key) => key in body);
    if (denied) {
      return { ok: false, code: "DENIED_PARAM", message: `Parameter '${denied}' is not allowed` };
    }
  }

  if (guards.valueRules && guards.valueRules.length > 0) {
    for (const rule of guards.valueRules) {
      const value = resolveValue(rule.path, body, query);
      if (rule.oneOf && !rule.oneOf.includes(value as never)) {
        return {
          ok: false,
          code: "VALUE_RULE",
          message: `Value at '${rule.path}' must be one of: ${rule.oneOf.join(", ")}`,
        };
      }
      if (rule.matches && typeof value === "string") {
        const regex = new RegExp(rule.matches);
        if (!regex.test(value)) {
          return {
            ok: false,
            code: "VALUE_RULE",
            message: `Value at '${rule.path}' does not match pattern`,
          };
        }
      }
      if (rule.maxLen != null && typeof value === "string" && value.length > rule.maxLen) {
        return {
          ok: false,
          code: "VALUE_RULE",
          message: `Value at '${rule.path}' exceeds max length ${rule.maxLen}`,
        };
      }
    }
  }

  if (guards.dryRunOnly) {
    const dryRunFlag = isDryRunRequested(body, query, req.headers);
    if (!dryRunFlag) {
      return {
        ok: false,
        code: "DRY_RUN_ONLY",
        message: "Operation allowed only in dry-run mode",
      };
    }
  }

  if (guards.rateLimit) {
    const ok = applyRateLimit(guards.rateLimit, context);
    if (!ok) {
      return {
        ok: false,
        code: "RATE_LIMIT",
        message: "Rate limit exceeded",
      };
    }
  }

  return { ok: true };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function resolveValue(path: string, body?: Record<string, unknown>, query?: Record<string, unknown>) {
  const segments = path.split(".");
  let current: unknown = undefined;
  const sourceFirst = [body, query];
  for (const source of sourceFirst) {
    if (!source) continue;
    current = source;
    let valid = true;
    for (const segment of segments) {
      if (!current || typeof current !== "object") {
        valid = false;
        break;
      }
      current = (current as Record<string, unknown>)[segment];
    }
    if (valid) break;
  }
  return current;
}

function isDryRunRequested(
  body?: Record<string, unknown>,
  query?: Record<string, unknown>,
  headers?: Record<string, string | string[] | undefined>,
): boolean {
  if (body && typeof body.dryRun === "boolean") return body.dryRun;
  if (query) {
    const value = query.dryRun;
    if (typeof value === "string") {
      return value === "1" || value.toLowerCase() === "true";
    }
    if (Array.isArray(value)) {
      return value.some((v) => v === "1" || v.toLowerCase() === "true");
    }
  }
  if (headers) {
    const header = headers["x-latchflow-dry-run"];
    if (typeof header === "string") {
      return header === "1" || header.toLowerCase() === "true";
    }
    if (Array.isArray(header)) {
      return header.some((v) => v === "1" || v.toLowerCase() === "true");
    }
  }
  return false;
}

function applyRateLimit(limits: NonNullable<Permission["input"]>["rateLimit"], context: InputGuardContext): boolean {
  const now = context.now?.getTime() ?? Date.now();
  const key = `${context.rulesHash ?? ""}:${context.ruleId ?? ""}:${context.userId ?? ""}`;
  const entries = rateLimitState.get(key) ?? [];
  const filtered = entries.filter((ts) => now - ts <= 60 * 60 * 1000);
  filtered.push(now);
  rateLimitState.set(key, filtered);

  if (limits?.burst != null) {
    const windowStart = now - 1000;
    const burstCount = filtered.filter((ts) => ts >= windowStart).length;
    if (burstCount > limits.burst) return false;
  }
  if (limits?.perMin != null) {
    const perMinWindow = now - 60_000;
    const perMinCount = filtered.filter((ts) => ts >= perMinWindow).length;
    if (perMinCount > limits.perMin) return false;
  }
  if (limits?.perHour != null) {
    const perHourWindow = now - 3_600_000;
    const perHourCount = filtered.filter((ts) => ts >= perHourWindow).length;
    if (perHourCount > limits.perHour) return false;
  }
  return true;
}

export function resetRateLimitState() {
  rateLimitState.clear();
}
