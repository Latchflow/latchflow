import type { RequestLike } from "../http/http-server.js";
import { parseCookies } from "../auth/cookies.js";
import { ADMIN_SESSION_COOKIE } from "../config.js";
import { getDb } from "../db.js";

function httpError(status: number, message: string) {
  const err = new Error(message) as Error & { status: number };
  err.status = status;
  return err;
}

export async function requireAdmin(req: RequestLike) {
  const cookies = parseCookies(req);
  const token = cookies[ADMIN_SESSION_COOKIE];
  if (!token) throw httpError(401, "Missing admin session");
  const db = getDb();
  const now = new Date();
  const session = await db.session.findUnique({ where: { jti: token }, include: { user: true } });
  if (!session || session.revokedAt || session.expiresAt <= now) {
    throw httpError(401, "Invalid or expired admin session");
  }
  const role = session.user.role;
  if (role !== "ADMIN" && role !== "EXECUTOR") {
    throw httpError(403, "Insufficient role");
  }
  return { user: session.user, session };
}
