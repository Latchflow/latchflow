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
      // Attach user to the request so downstream handlers can attribute writes
      const reqWithUser = req as typeof req & {
        user?: { id?: string; role?: string | null; isActive?: boolean };
      };
      type MinimalUser = { id: string; role?: string | null; isActive?: boolean | null };
      const u = user as unknown as MinimalUser;
      reqWithUser.user = {
        id: u.id,
        role: u.role ?? null,
        isActive: u.isActive !== false,
      };
      const ctx = buildContext(Object.assign({ user }, req));
      // v1 policy lookup
      const entry: PolicyEntry | undefined =
        typeof entryOrSignature === "string" ? POLICY[entryOrSignature] : entryOrSignature;
      const signature: string | undefined =
        typeof entryOrSignature === "string" ? entryOrSignature : undefined;
      if (!entry) {
        logDecision({ decision: "DENY", reason: "NO_POLICY", userId: ctx.userId, signature });
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
          signature,
        });
        return handler(reqWithUser, res);
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
          signature,
        });
        return handler(reqWithUser, res);
      }
      logDecision({
        decision: "DENY",
        reason: "NOT_ADMIN_V1",
        resource: entry.resource,
        action: entry.action,
        userId: ctx.userId,
        role: ctx.role,
        signature,
      });
      throw httpError(403, "Insufficient permission");
    };
  };
}
