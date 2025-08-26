import { describe, it, expect, vi } from "vitest";
import { registerAdminAuthRoutes } from "./admin.js";
import type { HttpHandler } from "../../http/http-server.js";

// Mutable in-file DB stub so tests can tailor behavior per case
const db = {
  user: { upsert: vi.fn(async ({ create }: any) => ({ id: "u1", email: create.email })) },
  magicLink: {
    create: vi.fn(async (): Promise<any> => ({ id: "m1" })),
    findUnique: vi.fn(async (): Promise<any> => null),
    update: vi.fn(async (): Promise<any> => ({})),
  },
  session: {
    create: vi.fn(async () => ({ jti: "s1" })),
    updateMany: vi.fn(async () => ({})),
  },
};

vi.mock("../../db/db.js", () => ({ getDb: () => db }));

function makeServer() {
  const handlers = new Map<string, HttpHandler>();
  const server = {
    get: (p: string, h: HttpHandler) => handlers.set(`GET ${p}`, h),
    post: (p: string, h: HttpHandler) => handlers.set(`POST ${p}`, h),
    put: () => {},
    delete: () => {},
    use: () => {},
  } as any;
  return { server, handlers };
}

describe("admin auth routes", () => {
  it("/auth/admin/start upserts user and returns 204", async () => {
    const { server, handlers } = makeServer();
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
    expect(db.user.upsert).toHaveBeenCalled();
    expect(db.magicLink.create).toHaveBeenCalled();
  });

  it("/auth/admin/logout clears cookie and returns 204", async () => {
    const { server, handlers } = makeServer();
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
    expect(db.session.updateMany).toHaveBeenCalled();
  });

  it("/auth/admin/callback 400 when token missing", async () => {
    const { server, handlers } = makeServer();
    const config = { AUTH_COOKIE_SECURE: false } as any;
    registerAdminAuthRoutes(server, config);
    const handler = handlers.get("GET /auth/admin/callback")!;
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

  it("/auth/admin/callback sets cookie and redirects when ADMIN_UI_ORIGIN provided", async () => {
    const { server, handlers } = makeServer();
    const config = {
      AUTH_SESSION_TTL_HOURS: 12,
      AUTH_COOKIE_SECURE: false,
      ADMIN_UI_ORIGIN: "https://admin",
    } as any;
    // Return a valid magic link for the provided token
    db.magicLink.findUnique.mockImplementationOnce(async () => ({
      id: "m1",
      userId: "u1",
      tokenHash: "hash",
      expiresAt: new Date(Date.now() + 60_000),
      consumedAt: null,
    }));
    db.session.create.mockResolvedValueOnce({ jti: "sess1" } as any);

    registerAdminAuthRoutes(server, config);
    const handler = handlers.get("GET /auth/admin/callback")!;
    let code = 0;
    const headers: Record<string, string | string[]> = {};
    let redirected: any[] = [];
    const token = "tok123";
    await handler({ query: { token } } as any, {
      status(c: number) {
        code = c;
        return this as any;
      },
      json() {},
      header(n: string, v: string | string[]) {
        headers[n] = v;
        return this as any;
      },
      redirect(url: string, status?: number) {
        redirected = [url, status];
      },
    });
    expect(code).toBe(0); // redirect path, no json
    expect(redirected[0]).toBe("https://admin");
    expect(String(headers["Set-Cookie"]).includes("lf_admin_sess=sess1")).toBe(true);
  });
});
