import type { HttpHandler } from "../http/http-server.js";
import type { AuthorizeDecision, PolicyEntry } from "../authz/types.js";
import { POLICY, type RouteSignature } from "../authz/policy.js";
import { buildContext } from "../authz/context.js";
import { requireSession } from "./require-session.js";
import { logDecision } from "../authz/decisionLog.js";
import { authorizeRequest } from "../authz/authorize.js";
import {
  getAuthzMode,
  getSystemUserId,
  isAdmin2faRequired,
  getReauthWindowMs,
} from "../authz/featureFlags.js";
import {
  recordAuthzDecision,
  recordAuthzTwoFactor,
  type AuthzEvaluationMode,
  type AuthzTwoFactorEvent,
} from "../observability/metrics.js";

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
      const startedAt = Date.now();
      const { user, session } = await requireSession(req);
      const reqWithUser = req as typeof req & {
        user?: { id?: string; role?: string | null; isActive?: boolean };
      };
      reqWithUser.user = {
        id: user.id,
        role: user.role ?? null,
        isActive: user.isActive !== false,
      };

      const ctx = buildContext(Object.assign({ user }, reqWithUser));
      const entry: PolicyEntry | undefined =
        typeof entryOrSignature === "string" ? POLICY[entryOrSignature] : entryOrSignature;
      const signature: string | undefined =
        typeof entryOrSignature === "string" ? entryOrSignature : undefined;
      const mode = getAuthzMode();
      const evaluationMode: AuthzEvaluationMode = mode === "enforce" ? "enforce" : "shadow";
      const systemUserId = getSystemUserId();

      if (!entry) {
        logDecision({ decision: "DENY", reason: "NO_POLICY", userId: ctx.userId, signature });
        throw httpError(403, "Policy not found");
      }

      if (mode !== "off") {
        const authzResult = authorizeRequest({
          entry,
          signature,
          req,
          context: ctx,
          user,
          evaluationMode,
          systemUserId,
        });
        const decision = applyPostDecisionControls({
          entry,
          authzDecision: authzResult.decision,
          matchedRule: authzResult.matchedRule,
          rulesHash: authzResult.rulesHash,
          presetId: authzResult.presetId,
          evaluationMode,
          mode,
          user,
          session,
          ctx,
          signature,
          startedAt,
        });

        if (evaluationMode === "enforce" && !decision.ok) {
          throw buildAuthzError(decision.reason);
        }

        if (evaluationMode === "enforce") {
          return handler(reqWithUser, res);
        }
        // fall through to legacy behavior when in shadow mode to preserve v1 semantics
      }

      const shouldLogLegacy = mode === "off";
      const allowLegacy = legacyAuthorize({
        entry,
        signature,
        ctx,
        log: shouldLogLegacy,
      });
      if (!allowLegacy) {
        throw httpError(403, "Insufficient permission");
      }
      return handler(reqWithUser, res);
    };
  };
}

type LegacyAuthorizeParams = {
  entry: PolicyEntry;
  signature?: string;
  ctx: ReturnType<typeof buildContext>;
  log: boolean;
};

type PostDecisionParams = {
  entry: PolicyEntry;
  authzDecision: AuthorizeDecision;
  matchedRule?: import("../authz/types.js").CompiledRule;
  rulesHash: string;
  presetId?: string;
  evaluationMode: AuthzEvaluationMode;
  mode: ReturnType<typeof getAuthzMode>;
  user: Record<string, unknown>;
  session: Record<string, unknown> & { createdAt?: Date };
  ctx: ReturnType<typeof buildContext>;
  signature?: string;
  startedAt: number;
};

function applyPostDecisionControls(params: PostDecisionParams): AuthorizeDecision {
  const {
    entry,
    authzDecision,
    matchedRule,
    rulesHash,
    presetId,
    evaluationMode,
    mode,
    user,
    session,
    ctx,
    signature,
    startedAt,
  } = params;

  const now = Date.now();
  const twoFactorResult = evaluateTwoFactorRequirement({
    decision: authzDecision,
    user,
    session,
    ctx,
  });
  const finalDecision = twoFactorResult.decision;

  const routeId = signature ?? `${entry.action} ${entry.resource}`;
  const httpMethod = signature ? signature.split(" ")[0] : "";
  const policyOutcome = authzDecision.ok ? "allow" : "deny";
  const effectiveDecision = mode === "enforce" ? (finalDecision.ok ? "allow" : "deny") : "allow";
  const metricsRole = ctx.role === "ADMIN" ? "ADMIN" : "EXECUTOR";

  recordAuthzDecision({
    routeId,
    httpMethod,
    evaluationMode,
    policyOutcome,
    effectiveDecision,
    reason: finalDecision.reason,
    resource: entry.resource,
    action: entry.action,
    userRole: metricsRole,
    userId: ctx.userId,
    presetId,
    rulesHash,
    ruleId: matchedRule?.id,
    durationMs: now - startedAt,
  });

  if (twoFactorResult.event) {
    recordAuthzTwoFactor({
      event: twoFactorResult.event,
      routeId,
      httpMethod,
      userRole: metricsRole,
      userId: ctx.userId,
      reason: twoFactorResult.reason,
    });
  }

  logDecision({
    decision: finalDecision.ok ? "ALLOW" : "DENY",
    reason: finalDecision.reason,
    resource: entry.resource,
    action: entry.action,
    userId: ctx.userId,
    role: ctx.role,
    signature,
    shadowMode: evaluationMode === "shadow",
  });

  return finalDecision;
}

function evaluateTwoFactorRequirement(params: {
  decision: AuthorizeDecision;
  user: Record<string, unknown>;
  session: Record<string, unknown> & { createdAt?: Date };
  ctx: ReturnType<typeof buildContext>;
}): {
  decision: AuthorizeDecision;
  event?: AuthzTwoFactorEvent;
  reason?: "missing_2fa" | "stale_reauth" | "invalid_code" | "locked_out" | "unknown";
} {
  const { decision, user, session, ctx } = params;
  if (!decision.ok) {
    return { decision };
  }
  if (ctx.role !== "ADMIN" || !isAdmin2faRequired()) {
    return { decision };
  }

  const mfaEnabled = (user as { mfaEnabled?: boolean | null }).mfaEnabled === true;
  const windowMs = getReauthWindowMs();
  const sessionLike = session as {
    createdAt?: Date;
    reauthenticatedAt?: Date | string | null;
    mfaVerifiedAt?: Date | string | null;
  };
  const lastAuthSource =
    sessionLike.reauthenticatedAt ?? sessionLike.mfaVerifiedAt ?? sessionLike.createdAt;
  const lastAuthTs = lastAuthSource ? new Date(lastAuthSource).getTime() : NaN;
  const now = Date.now();

  if (!mfaEnabled) {
    return {
      decision: { ok: false, reason: "MFA_REQUIRED" },
      event: "challenge_required",
      reason: "missing_2fa",
    };
  }

  if (!Number.isFinite(lastAuthTs) || now - lastAuthTs > windowMs) {
    return {
      decision: { ok: false, reason: "MFA_REQUIRED" },
      event: "session_expired",
      reason: "stale_reauth",
    };
  }

  return {
    decision,
    event: "challenge_satisfied",
  };
}

function legacyAuthorize(params: LegacyAuthorizeParams): boolean {
  const { entry, signature, ctx, log } = params;
  const logFn = log
    ? (decision: "ALLOW" | "DENY", reason: string) => {
        logDecision({
          decision,
          reason,
          resource: entry.resource,
          action: entry.action,
          userId: ctx.userId,
          role: ctx.role,
          signature,
        });
      }
    : () => {};

  if (ctx.role === "ADMIN") {
    logFn("ALLOW", "ADMIN");
    return true;
  }
  if (entry.v1AllowExecutor) {
    logFn("ALLOW", "V1_EXECUTOR_ALLOW");
    return true;
  }
  logFn("DENY", "NOT_ADMIN_V1");
  return false;
}

function buildAuthzError(reason: AuthorizeDecision["reason"]): Error & { status: number } {
  switch (reason) {
    case "RATE_LIMIT":
      return httpError(429, "Rate limit exceeded");
    case "MFA_REQUIRED":
      return httpError(401, "Two-factor authentication required");
    case "INACTIVE":
      return httpError(403, "Inactive user");
    case "NO_POLICY":
      return httpError(403, "Policy not found");
    default:
      return httpError(403, "Insufficient permission");
  }
}
