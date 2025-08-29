import { describe, it, expect, vi, beforeEach } from "vitest";
import { registerAdminAuthRoutes } from "./admin.js";
import type { HttpHandler } from "../../http/http-server.js";

// Mutable in-file DB stub so tests can tailor behavior per case
const db = {
  $transaction: vi.fn(async (fn: any, _opts?: any) => await fn(db)),
  user: {
    upsert: vi.fn(async ({ create }: any) => ({
      id: "u1",
      email: create.email,
      roles: create.roles,
    })),
    count: vi.fn(async () => 0),
    findUnique: vi.fn(async () => null as any),
    findFirst: vi.fn(async () => null as any),
    update: vi.fn(async () => ({}) as any),
  },
  magicLink: {
    create: vi.fn(async (): Promise<any> => ({ id: "m1" })),
    findUnique: vi.fn(async (): Promise<any> => null),
    updateMany: vi.fn(async (): Promise<any> => ({ count: 0 })),
    update: vi.fn(async (): Promise<any> => ({})),
  },
  session: {
    create: vi.fn(async () => ({ jti: "s1" })),
    findUnique: vi.fn(async () => null as any),
    findMany: vi.fn(async () => [] as any[]),
    updateMany: vi.fn(async () => ({})),
  },
};

vi.mock("../../db/db.js", () => ({ getDb: () => db }));

beforeEach(() => {
  // Reset and restore default implementations to avoid cross-test leakage
  db.$transaction.mockReset().mockImplementation(async (fn: any) => await fn(db));

  db.user.upsert.mockReset().mockImplementation(async ({ create }: any) => ({
    id: "u1",
    email: create.email,
    roles: create.roles,
  }));
  db.user.count.mockReset().mockResolvedValue(0);
  db.user.findUnique.mockReset().mockResolvedValue(null as any);
  db.user.findFirst.mockReset().mockResolvedValue(null as any);
  db.user.update.mockReset().mockResolvedValue({} as any);

  db.magicLink.create.mockReset().mockResolvedValue({ id: "m1" } as any);
  db.magicLink.updateMany.mockReset().mockResolvedValue({ count: 0 } as any);
  db.magicLink.findUnique.mockReset().mockResolvedValue(null as any);
  db.magicLink.update.mockReset().mockResolvedValue({} as any);

  db.session.create.mockReset().mockResolvedValue({ jti: "s1" } as any);
  db.session.findUnique.mockReset().mockResolvedValue(null as any);
  db.session.findMany.mockReset().mockResolvedValue([] as any[]);
  db.session.updateMany.mockReset().mockResolvedValue({} as any);
});

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
  it("/auth/admin/start returns 400 on invalid body", async () => {
    const { server, handlers } = makeServer();
    const config = { AUTH_COOKIE_SECURE: false } as any;
    registerAdminAuthRoutes(server, config);
    const handler = handlers.get("POST /auth/admin/start")!;
    let code = 0;
    let body: any = null;
    await handler({ body: {} } as any, {
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

  it("/auth/admin/start creates magic link and returns 204 when user exists/created", async () => {
    const { server, handlers } = makeServer();
    const config = {
      ADMIN_MAGICLINK_TTL_MIN: 15,
      AUTH_SESSION_TTL_HOURS: 12,
      AUTH_COOKIE_SECURE: false,
    } as any;
    // Let the tx callback run; emulate existing user fast-path
    db.user.findUnique.mockResolvedValueOnce({ id: "u1", email: "a@b.co", roles: [] } as any);
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
    expect(db.magicLink.create).toHaveBeenCalled();
  });

  it("/auth/admin/start returns 200 with login_url when ALLOW_DEV_AUTH=true", async () => {
    const { server, handlers } = makeServer();
    const config = {
      ADMIN_MAGICLINK_TTL_MIN: 15,
      AUTH_SESSION_TTL_HOURS: 12,
      AUTH_COOKIE_SECURE: false,
      ALLOW_DEV_AUTH: true,
    } as any;
    // Existing user fast-path so route reaches dev-auth branch
    db.user.findUnique.mockResolvedValueOnce({
      id: "u1",
      email: "dev@example.com",
      roles: [],
    } as any);
    registerAdminAuthRoutes(server, config);
    const handler = handlers.get("POST /auth/admin/start")!;
    let code = 0;
    let body: any = null;
    await handler({ body: { email: "dev@example.com" } } as any, {
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
    expect(code).toBe(200);
    expect(typeof body?.login_url).toBe("string");
    expect(body.login_url.includes("/auth/admin/callback?token=")).toBe(true);
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

  it("/auth/admin/callback 401 when token invalid/expired", async () => {
    const { server, handlers } = makeServer();
    const config = { AUTH_COOKIE_SECURE: false } as any;

    db.magicLink.updateMany.mockResolvedValueOnce({ count: 0 } as any);
    registerAdminAuthRoutes(server, config);
    const handler = handlers.get("GET /auth/admin/callback")!;
    let code = 0;
    let body: any = null;
    await handler({ query: { token: "bad" } } as any, {
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
    expect(code).toBe(401);
    expect(body?.code).toBe("INVALID_TOKEN");
  });

  it("/auth/admin/callback sets cookie and redirects when ADMIN_UI_ORIGIN provided", async () => {
    const { server, handlers } = makeServer();
    const config = {
      AUTH_SESSION_TTL_HOURS: 12,
      AUTH_COOKIE_SECURE: false,
      ADMIN_UI_ORIGIN: "https://admin",
    } as any;
    // Return a valid magic link for the provided token
    db.magicLink.updateMany.mockResolvedValueOnce({ count: 1 } as any);
    db.magicLink.findUnique.mockImplementationOnce(async () => ({
      id: "m1",
      userId: "u1",
      tokenHash: "hash",
      expiresAt: new Date(Date.now() + 60_000),
      consumedAt: null,
    }));
    // Pretend there are multiple users so bootstrap doesn't run in this test
    db.user.count.mockResolvedValueOnce(2);
    // Active user check passes
    db.user.findUnique.mockResolvedValueOnce({ id: "u1", isActive: true } as any);
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

  it("/auth/admin/start returns 204 for unknown email post-bootstrap (no enumeration)", async () => {
    const { server, handlers } = makeServer();
    const config = {
      ADMIN_MAGICLINK_TTL_MIN: 15,
      AUTH_SESSION_TTL_HOURS: 12,
      AUTH_COOKIE_SECURE: false,
    } as any;
    // Users exist already
    db.user.count.mockResolvedValueOnce(2);
    // Unknown email
    db.user.findUnique.mockResolvedValueOnce(null as any);
    registerAdminAuthRoutes(server, config);
    const handler = handlers.get("POST /auth/admin/start")!;
    let code = 0;
    let body: any = null;
    await handler({ body: { email: "nobody@example.com" } } as any, {
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
    expect(code).toBe(204);
  });

  it("/auth/admin/callback issues session when only one user exists (bootstrap tested separately)", async () => {
    const { server, handlers } = makeServer();
    const config = { AUTH_SESSION_TTL_HOURS: 12, AUTH_COOKIE_SECURE: false } as any;

    db.magicLink.updateMany.mockResolvedValueOnce({ count: 1 } as any);

    // Valid magic link for token
    db.magicLink.findUnique.mockResolvedValue({
      id: "m1",
      userId: "u1",
      tokenHash: "hash",
      expiresAt: new Date(Date.now() + 60_000),
      consumedAt: null,
    } as any);

    // Only one user in the system → bootstrap path enabled
    db.user.count.mockResolvedValueOnce(1);

    // 1) active-user check (outside tx), 2) in-tx fetch with roles
    db.user.findUnique
      .mockResolvedValueOnce({ id: "u1", isActive: true } as any)
      .mockResolvedValueOnce({ id: "u1", email: "first@example.com", roles: [] } as any);

    registerAdminAuthRoutes(server, config);
    const handler = handlers.get("GET /auth/admin/callback")!;
    let code = 0;

    await handler({ query: { token: "tok123" } } as any, {
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

  it("GET /auth/me returns 401 when not authenticated", async () => {
    const { server, handlers } = makeServer();
    const config = { AUTH_COOKIE_SECURE: false } as any;
    registerAdminAuthRoutes(server, config);
    const handler = handlers.get("GET /auth/me")!;
    let code = 0;
    let body: any = null;
    await handler({ headers: {} } as any, {
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
    expect(code).toBe(401);
    expect(body?.code).toBe("UNAUTHORIZED");
  });

  it("GET /auth/me returns user and session when authenticated", async () => {
    const { server, handlers } = makeServer();
    const config = { AUTH_COOKIE_SECURE: false } as any;
    const now = new Date(Date.now() + 60_000);
    db.session.findUnique.mockResolvedValueOnce({
      jti: "sess1",
      expiresAt: now,
      revokedAt: null,
      user: { id: "u1", email: "a@b.co", roles: ["ADMIN"] },
    } as any);
    registerAdminAuthRoutes(server, config);
    const handler = handlers.get("GET /auth/me")!;
    let code = 0;
    let body: any = null;
    await handler({ headers: { cookie: "lf_admin_sess=sess1" } } as any, {
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
    expect(code).toBe(200);
    expect(body?.user?.email).toBe("a@b.co");
    expect(body?.user?.roles).toEqual(["ADMIN"]);
  });

  it("GET /whoami returns kind=admin when authenticated", async () => {
    const { server, handlers } = makeServer();
    const config = { AUTH_COOKIE_SECURE: false } as any;
    const now = new Date(Date.now() + 60_000);
    db.session.findUnique.mockResolvedValueOnce({
      jti: "sess1",
      expiresAt: now,
      revokedAt: null,
      user: { id: "u1", email: "a@b.co", roles: ["EXECUTOR"] },
    } as any);
    registerAdminAuthRoutes(server, config);
    const handler = handlers.get("GET /whoami")!;
    let code = 0;
    let body: any = null;
    await handler({ headers: { cookie: "lf_admin_sess=sess1" } } as any, {
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
    expect(code).toBe(200);
    expect(body?.kind).toBe("admin");
    expect(body?.user?.email).toBe("a@b.co");
  });

  it("GET /auth/sessions lists sessions for current user", async () => {
    const { server, handlers } = makeServer();
    const config = { AUTH_COOKIE_SECURE: false } as any;
    const now = new Date(Date.now() + 60_000);
    db.session.findUnique.mockResolvedValueOnce({
      jti: "sess1",
      expiresAt: now,
      revokedAt: null,
      user: { id: "u1", email: "a@b.co", roles: ["ADMIN"] },
    } as any);
    db.session.findMany.mockResolvedValueOnce([
      {
        id: "sess1",
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 3600_000).toISOString(),
        lastSeenAt: new Date().toISOString(),
        ip: "127.0.0.1",
        userAgent: "test",
      },
    ] as any);
    registerAdminAuthRoutes(server, config);
    const handler = handlers.get("GET /auth/sessions")!;
    let code = 0;
    let body: any = null;
    await handler({ headers: { cookie: "lf_admin_sess=sess1" } } as any, {
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
    expect(code).toBe(200);
    expect(Array.isArray(body?.items)).toBe(true);
    expect(body.items[0].id).toBe("sess1");
  });

  it("POST /auth/sessions/revoke revokes a session for current user", async () => {
    const { server, handlers } = makeServer();
    const config = { AUTH_COOKIE_SECURE: false } as any;
    const now = new Date(Date.now() + 60_000);
    db.session.findUnique.mockResolvedValueOnce({
      jti: "sess1",
      expiresAt: now,
      revokedAt: null,
      user: { id: "u1", email: "a@b.co", roles: ["ADMIN"] },
    } as any);
    registerAdminAuthRoutes(server, config);
    const handler = handlers.get("POST /auth/sessions/revoke")!;
    let code = 0;
    await handler(
      { headers: { cookie: "lf_admin_sess=sess1" }, body: { sessionId: "sess2" } } as any,
      {
        status(c: number) {
          code = c;
          return this as any;
        },
        json() {},
        header() {
          return this as any;
        },
        redirect() {},
      },
    );
    expect(code).toBe(204);
    expect(db.session.updateMany).toHaveBeenCalled();
  });
});
