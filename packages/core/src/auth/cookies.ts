import type { ResponseLike, RequestLike } from "../http/http-server.js";

export type CookieOptions = {
  httpOnly?: boolean;
  secure?: boolean;
  path?: string;
  sameSite?: "Lax" | "Strict" | "None";
  domain?: string;
  maxAgeSec?: number;
};

function serializeCookie(name: string, value: string, opts: CookieOptions = {}): string {
  const parts: string[] = [];
  parts.push(`${encodeURIComponent(name)}=${encodeURIComponent(value)}`);
  parts.push(`Path=${opts.path ?? "/"}`);
  if (opts.httpOnly !== false) parts.push("HttpOnly");
  if (opts.sameSite) parts.push(`SameSite=${opts.sameSite}`);
  if (opts.secure) parts.push("Secure");
  if (opts.domain) parts.push(`Domain=${opts.domain}`);
  if (opts.maxAgeSec != null) {
    parts.push(`Max-Age=${Math.floor(opts.maxAgeSec)}`);
    const expires = new Date(Date.now() + opts.maxAgeSec * 1000);
    parts.push(`Expires=${expires.toUTCString()}`);
  }
  return parts.join("; ");
}

export function setCookie(
  res: ResponseLike,
  name: string,
  value: string,
  opts: CookieOptions = {},
) {
  const cookie = serializeCookie(name, value, {
    httpOnly: opts.httpOnly ?? true,
    sameSite: opts.sameSite ?? "Lax",
    secure: opts.secure ?? false,
    path: opts.path ?? "/",
    domain: opts.domain,
    maxAgeSec: opts.maxAgeSec,
  });
  res.header("Set-Cookie", cookie);
}

export function clearCookie(res: ResponseLike, name: string, opts: CookieOptions = {}) {
  const cookie = serializeCookie(name, "", {
    httpOnly: opts.httpOnly ?? true,
    sameSite: opts.sameSite ?? "Lax",
    secure: opts.secure ?? false,
    path: opts.path ?? "/",
    domain: opts.domain,
    maxAgeSec: 0,
  });
  res.header("Set-Cookie", cookie);
}

export function parseCookies(req: RequestLike): Record<string, string> {
  const header = (req.headers?.["cookie"] as string | undefined) ?? "";
  const out: Record<string, string> = {};
  if (!header) return out;
  const pairs = header.split(/;\s*/);
  for (const p of pairs) {
    const idx = p.indexOf("=");
    if (idx === -1) continue;
    const k = decodeURIComponent(p.slice(0, idx).trim());
    const v = decodeURIComponent(p.slice(idx + 1).trim());
    out[k] = v;
  }
  return out;
}
