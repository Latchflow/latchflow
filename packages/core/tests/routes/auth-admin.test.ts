import { describe, it, expect, vi } from "vitest";
import { registerAdminAuthRoutes } from "../../src/routes/auth/admin.js";
import type { HttpHandler } from "../../src/http/http-server.js";

vi.mock("../../src/db.js", () => {
  return {
    getDb: () => ({
      user: { upsert: vi.fn(async ({ create }: any) => ({ id: "u1", email: create.email })) },
      magicLink: { create: vi.fn(async () => ({ id: "m1" })) },
      session: { create: vi.fn(async () => ({ jti: "s1" })), updateMany: vi.fn(async () => ({})) },
    }),
  };
});

describe("admin auth routes", () => {
  it("/auth/admin/start upserts user and returns 204", async () => {
    const handlers = new Map<string, HttpHandler>();
    const server = {
      post: (p: string, h: HttpHandler) => handlers.set(`POST ${p}`, h),
      get: () => {},
    } as any;
    // Minimal config
    const config = {
      ADMIN_MAGICLINK_TTL_MIN: 15,
      AUTH_SESSION_TTL_HOURS: 12,
      AUTH_COOKIE_SECURE: false,
    } as any;
    registerAdminAuthRoutes(server, config);
    const handler = handlers.get("POST /auth/admin/start")!;
    let code = 0;
    await handler({ body: { email: "a@b.co" } } as any, {
      status(c: number) {
        code = c;
        return this as any;
      },
      json() {},
      header() {
        return this as any;
      },
      redirect() {},
    });
    expect(code).toBe(204);
  });

  it("/auth/admin/logout clears cookie and returns 204", async () => {
    const handlers = new Map<string, HttpHandler>();
    const server = {
      post: (p: string, h: HttpHandler) => handlers.set(`POST ${p}`, h),
      get: () => {},
    } as any;
    const config = { AUTH_COOKIE_SECURE: false } as any;
    registerAdminAuthRoutes(server, config);
    const handler = handlers.get("POST /auth/admin/logout")!;
    let code = 0;
    const headers: Record<string, string | string[]> = {};
    await handler({ headers: { cookie: "lf_admin_sess=abc" } } as any, {
      status(c: number) {
        code = c;
        return this as any;
      },
      json() {},
      header(n: string, v: string | string[]) {
        headers[n] = v;
        return this as any;
      },
      redirect() {},
    });
    expect(code).toBe(204);
    expect(String(headers["Set-Cookie"]).includes("Max-Age=0")).toBe(true);
  });
  it("/auth/admin/callback 400 when token missing", async () => {
    const handlers = new Map<string, HttpHandler>();
    const server = {
      get: (p: string, h: HttpHandler) => handlers.set(`GET ${p}`, h),
      post: () => {},
    } as any;
    const config = { AUTH_COOKIE_SECURE: false } as any;
    registerAdminAuthRoutes(server, config);
    const h = handlers.get("/auth/admin/callback") || handlers.get("GET /auth/admin/callback");
    // createExpressServer uses path with full path string matching; our registry stores exact key above
    const handler = handlers.get("GET /auth/admin/callback") as any;
    let code = 0;
    let body: any = null;
    await handler({ query: {} } as any, {
      status(c: number) {
        code = c;
        return this as any;
      },
      json(p: any) {
        body = p;
      },
      header() {
        return this as any;
      },
      redirect() {},
    });
    expect(code).toBe(400);
    expect(body?.code).toBe("BAD_REQUEST");
  });
});
