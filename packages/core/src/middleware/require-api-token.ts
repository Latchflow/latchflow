import type { HttpHandler, RequestLike } from "../http/http-server.js";
import { getDb } from "../db/db.js";
import { sha256Hex } from "../auth/tokens.js";

type WithToken = RequestLike & {
  user?: { id: string; email: string; role?: string };
  apiToken?: { id: string; scopes: string[] };
  hasScope?: (scope: string) => boolean;
};

function httpError(status: number, message: string) {
  const err = new Error(message) as Error & { status: number };
  err.status = status;
  return err;
}

export function requireApiToken(
  requiredScopes: string[] = [],
): (handler: HttpHandler) => HttpHandler {
  return (handler: HttpHandler): HttpHandler => {
    return async (req, res) => {
      const db = getDb();
      const auth = (req.headers?.["authorization"] as string | undefined) ?? "";
      const m = auth.match(/^Bearer\s+(.+)$/i);
      if (!m) throw httpError(401, "Missing bearer token");
      const presented = m[1]!.trim();
      // Strip optional prefix before hashing (prefix isn't part of hash)
      const token = presented.replace(/^\w+_/, "");
      const tokenHash = sha256Hex(token);
      const apiToken = await db.apiToken.findUnique({
        where: { tokenHash },
        include: { user: true },
      });
      if (!apiToken || apiToken.revokedAt) throw httpError(401, "Invalid token");
      if (apiToken.expiresAt && apiToken.expiresAt <= new Date())
        throw httpError(401, "Token expired");
      const ownerActive = (apiToken.user as unknown as { isActive?: boolean }).isActive;
      if (ownerActive === false) throw httpError(403, "Inactive user");
      const hasScope = (s: string) => apiToken.scopes.includes(s);
      for (const s of requiredScopes) {
        if (!hasScope(s)) throw httpError(403, "Insufficient scope");
      }
      // Mark token as used after scope verification
      await db.apiToken.update({ where: { id: apiToken.id }, data: { lastUsedAt: new Date() } });
      const req2 = req as WithToken;
      req2.user = {
        id: apiToken.user.id,
        email: apiToken.user.email,
        role: (apiToken.user as unknown as { role?: string | null }).role ?? undefined,
      };
      req2.apiToken = { id: apiToken.id, scopes: apiToken.scopes };
      req2.hasScope = hasScope;
      return handler(req2, res);
    };
  };
}
