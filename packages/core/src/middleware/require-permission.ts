import type { HttpHandler } from "../http/http-server.js";
import type { PolicyEntry } from "../authz/types.js";
import { POLICY, type RouteSignature } from "../authz/policy.js";
import { buildContext } from "../authz/context.js";
import { requireSession } from "./require-session.js";
import { logDecision } from "../authz/decisionLog.js";

function httpError(status: number, message: string) {
  const err = new Error(message) as Error & { status: number };
  err.status = status;
  return err;
}

export function requirePermission(
  entryOrSignature: PolicyEntry | RouteSignature,
): (handler: HttpHandler) => HttpHandler {
  return (handler) => {
    return async (req, res) => {
      // First, validate session and get user (no role gating here)
      const { user } = await requireSession(req);
      const ctx = buildContext(Object.assign({ user }, req));
      // v1 policy lookup
      const entry: PolicyEntry | undefined =
        typeof entryOrSignature === "string" ? POLICY[entryOrSignature] : entryOrSignature;
      if (!entry) {
        logDecision({ decision: "DENY", reason: "NO_POLICY", userId: ctx.userId });
        throw httpError(403, "Policy not found");
      }
      // Admins always allowed in v1
      if (ctx.role === "ADMIN") {
        logDecision({
          decision: "ALLOW",
          reason: "ADMIN",
          resource: entry.resource,
          action: entry.action,
          userId: ctx.userId,
        });
        return handler(req, res);
      }
      // Non-admin: allow only when explicitly marked for v1 (typically reads)
      if (entry.v1AllowExecutor) {
        logDecision({
          decision: "ALLOW",
          reason: "V1_EXECUTOR_ALLOW",
          resource: entry.resource,
          action: entry.action,
          userId: ctx.userId,
          role: ctx.role,
        });
        return handler(req, res);
      }
      logDecision({
        decision: "DENY",
        reason: "NOT_ADMIN_V1",
        resource: entry.resource,
        action: entry.action,
        userId: ctx.userId,
        role: ctx.role,
      });
      throw httpError(403, "Insufficient permission");
    };
  };
}
