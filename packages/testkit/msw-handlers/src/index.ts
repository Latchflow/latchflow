import type { ScenarioHandlers } from "@latchflow/testkit-scenarios";
import { AuthGates } from "@latchflow/testkit-utils";

type Resolver = (args: { request: RequestLike }) => unknown | Promise<unknown>;

interface HttpHandlerApi {
  get: (mask: string | RegExp, resolver: Resolver) => unknown;
  post: (mask: string | RegExp, resolver: Resolver) => unknown;
  put: (mask: string | RegExp, resolver: Resolver) => unknown;
  delete: (mask: string | RegExp, resolver: Resolver) => unknown;
}

interface HttpResponseCtor {
  new (body?: unknown, init?: { status?: number; headers?: Record<string, string> }): unknown;
  json: (data: unknown, init?: { status?: number; headers?: Record<string, string> }) => unknown;
  notFound?: () => unknown;
}

export interface MswApi {
  http: HttpHandlerApi;
  HttpResponse: HttpResponseCtor;
}

interface RequestLike {
  url: string;
  method: string;
  headers: unknown;
  json?: () => Promise<unknown>;
  text?: () => Promise<string>;
}

function pathToRegex(path: string): RegExp {
  // very small path param matcher, e.g. /bundles/:bundleId/objects
  const re = path.replace(/:[^/]+/g, "([^/]+)");
  return new RegExp("^" + re + "$");
}

export function buildMswHandlers(handlers: ScenarioHandlers, msw: MswApi) {
  const { http, HttpResponse } = msw;
  const out: unknown[] = [];
  for (const rd of handlers.routes) {
    const regex = pathToRegex(rd.path);
    const fn: Resolver = async ({ request }) => {
      const url = new URL(request.url);
      if (!regex.test(url.pathname))
        return msw.HttpResponse.notFound?.() ?? new msw.HttpResponse(null, { status: 404 });
      const req = {
        url,
        method: request.method,
        headers: headersToObject(request.headers),
        body: await safeBody(request),
      } as const;
      const auth = new AuthGates();
      const res = rd.handler({ store: undefined as unknown as never, req, auth });
      const headers = res.headers || {};
      if (res.json !== undefined)
        return HttpResponse.json(res.json, { status: res.status, headers });
      return new HttpResponse(res.body ?? null, { status: res.status, headers });
    };
    switch (rd.method) {
      case "GET":
        out.push(http.get(regex, fn));
        break;
      case "POST":
        out.push(http.post(regex, fn));
        break;
      case "PUT":
        out.push(http.put(regex, fn));
        break;
      case "DELETE":
        out.push(http.delete(regex, fn));
        break;
    }
  }
  return out;
}

function headersToObject(headers: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  // Try Headers-like with forEach
  if (headers && typeof (headers as { forEach?: unknown }).forEach === "function") {
    (headers as { forEach: (cb: (v: string, k: string) => void) => void }).forEach((v, k) => {
      out[k] = v;
    });
    return out;
  }
  // Try iterable of [k,v]
  if (headers && typeof (headers as Iterable<unknown>)[Symbol.iterator] === "function") {
    for (const entry of headers as Iterable<unknown>) {
      const [k, v] = entry as [string, string];
      out[k] = v;
    }
    return out;
  }
  // Try plain object
  if (headers && typeof headers === "object") {
    for (const [k, v] of Object.entries(headers as Record<string, string>)) out[k] = String(v);
  }
  return out;
}

async function safeBody(request: RequestLike): Promise<unknown> {
  try {
    const getHeader = (name: string): string => {
      const h = request.headers as { get?: (n: string) => string | null } | Record<string, string>;
      if (typeof (h as { get?: unknown }).get === "function")
        return ((h as { get: (n: string) => string | null }).get(name) ?? "") as string;
      return (h as Record<string, string>)[name] ?? "";
    };
    const ct = getHeader("content-type") || "";
    if (ct.includes("application/json") && typeof request.json === "function")
      return await request.json();
    if (typeof request.text === "function") return await request.text();
    return undefined;
  } catch {
    return undefined;
  }
}

export * as scenarios from "@latchflow/testkit-scenarios";

export function makeHandlers(handlers: ScenarioHandlers) {
  return (msw: MswApi) => buildMswHandlers(handlers, msw);
}
