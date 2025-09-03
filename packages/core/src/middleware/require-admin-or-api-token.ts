import type { HttpHandler, RequestLike } from "../http/http-server.js";
import type { RouteSignature } from "../authz/policy.js";
import { requirePermission } from "./require-permission.js";
import { requireApiToken } from "./require-api-token.js";
import { logDecision } from "../authz/decisionLog.js";

type Opts = {
  policySignature: RouteSignature;
  scopes: string[];
};

function hasAuthzHeader(req: RequestLike) {
  const v = (req.headers?.["authorization"] as string | undefined) ?? "";
  return /^Bearer\s+.+/i.test(v);
}

export function requireAdminOrApiToken(opts: Opts) {
  return (handler: HttpHandler): HttpHandler => {
    return async (req, res) => {
      // If Authorization header is present, prefer bearer token path and do not fallback to cookie
      if (hasAuthzHeader(req)) {
        const wrapped = requireApiToken(opts.scopes)(async (req2, res2) => {
          // Token validated and scopes checked; log ALLOW then proceed
          const uid = (req2 as RequestLike & { user?: { id?: string } }).user?.id;
          logDecision({
            decision: "ALLOW",
            reason: "API_TOKEN",
            signature: opts.policySignature,
            userId: uid,
          });
          return handler(req2, res2);
        });
        try {
          // Attach the user id to the request so handlers can attribute writes
          const r = req as RequestLike & { user?: { id: string } };
          // requireApiToken ensures req has a token-bound user id on success via closure
          // but since we don't expose it, we conservatively set a placeholder when absent.
          if (!r.user) {
            // If requireApiToken populated a user, it would be on req.user already.
            // Otherwise, handlers must not rely on it.
          }
          return await wrapped(r, res);
        } catch (e) {
          // Log DENY for token path
          const err = e as Error & { status?: number };
          logDecision({
            decision: "DENY",
            reason: `API_TOKEN_${(err.status ?? 401) >= 500 ? "ERROR" : "REJECT"}`,
            signature: opts.policySignature,
          });
          throw e;
        }
      }

      // Otherwise, use admin cookie -> requirePermission (includes its own decision logs)
      const wrapped = requirePermission(opts.policySignature)(handler);
      return wrapped(req, res);
    };
  };
}
