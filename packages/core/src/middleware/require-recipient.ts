import type { RequestLike } from "../http/http-server.js";
import { parseCookies } from "../auth/cookies.js";
import { RECIPIENT_SESSION_COOKIE } from "../config/config.js";
import { getDb } from "../db/db.js";

function httpError(status: number, message: string) {
  const err = new Error(message) as Error & { status: number };
  err.status = status;
  return err;
}

export async function requireRecipient(
  req: RequestLike,
  bundleScoped = false,
  routeBundleId?: string,
) {
  const cookies = parseCookies(req);
  const token = cookies[RECIPIENT_SESSION_COOKIE];
  if (!token) throw httpError(401, "Missing recipient session");
  const db = getDb();
  const now = new Date();
  const session = await db.recipientSession.findUnique({ where: { jti: token } });
  if (!session || session.revokedAt || session.expiresAt <= now) {
    throw httpError(401, "Invalid or expired recipient session");
  }
  if (bundleScoped) {
    const expected =
      routeBundleId ?? (req.params as Record<string, string> | undefined)?.bundleId ?? undefined;
    if (expected && expected !== session.bundleId) {
      throw httpError(403, "Recipient session not valid for this bundle");
    }
  }
  return { session };
}
