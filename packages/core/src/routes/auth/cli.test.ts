import { describe, it, expect, vi } from "vitest";
import { registerCliAuthRoutes } from "./cli.js";
import type { HttpHandler } from "../../http/http-server.js";

// Stateful DB stub to drive different branches
const state = { mode: "pending" as "pending" | "null" | "expired" | "approved" | "revoked" };
const db = {
  user: { upsert: vi.fn(async ({ create }: any) => ({ id: "u1", email: create.email })) },
  deviceAuth: {
    create: vi.fn(async (args: any) => ({ ...args.data })),
    update: vi.fn(async () => ({})),
    findFirst: vi.fn(
      async ({ where: { deviceCodeHash, userCodeHash } = {} as any } = {} as any) => {
        // If querying by userCodeHash (approve flow), just return a valid pending record by default
        if (userCodeHash) {
          const now = Date.now();
          return {
            id: "d-user",
            userId: "u1",
            deviceCodeHash: "devhash",
            userCodeHash,
            intervalSec: 5,
            expiresAt: new Date(now + 60_000),
            approvedAt: null,
            tokenId: null,
            deviceName: "dev",
          };
        }
        // Poll branches keyed by state.mode
        if (state.mode === "null") return null;
        if (state.mode === "expired")
          return {
            id: "d1",
            deviceCodeHash,
            intervalSec: 5,
            expiresAt: new Date(Date.now() - 1000),
            approvedAt: null,
            tokenId: null,
          } as any;
        if (state.mode === "approved")
          return {
            id: "d1",
            deviceCodeHash,
            intervalSec: 5,
            expiresAt: new Date(Date.now() + 60000),
            approvedAt: new Date(),
            tokenId: "t1",
          } as any;
        if (state.mode === "revoked")
          return {
            id: "d1",
            deviceCodeHash,
            intervalSec: 5,
            expiresAt: new Date(Date.now() + 60000),
            approvedAt: new Date(),
            tokenId: "t1",
          } as any;
        return {
          id: "d1",
          deviceCodeHash,
          intervalSec: 5,
          expiresAt: new Date(Date.now() + 60000),
          approvedAt: null,
          tokenId: null,
        } as any;
      },
    ),
  },
  apiToken: {
    create: vi.fn(async () => ({ id: "t1", scopes: ["core:read"], expiresAt: null })),
    findUnique: vi.fn(async () =>
      state.mode === "revoked"
        ? ({ id: "t1", scopes: ["core:read"], revokedAt: new Date() } as any)
        : ({ id: "t1", scopes: ["core:read"], revokedAt: null } as any),
    ),
    findMany: vi.fn(async () => []),
    updateMany: vi.fn(async () => ({})),
  },
};

vi.mock("../../db/db.js", () => ({ getDb: () => db }));
vi.mock("../../middleware/require-admin.js", () => {
  return {
    requireAdmin: vi.fn(async () => ({ user: { id: "u1", role: "ADMIN" }, session: {} })),
  };
});

function makeServer() {
  const handlers = new Map<string, HttpHandler>();
  const server = {
    post: (p: string, h: HttpHandler) => handlers.set(`POST ${p}`, h),
    get: (p: string, h: HttpHandler) => handlers.set(`GET ${p}`, h),
  } as any;
  const config = {
    DEVICE_CODE_TTL_MIN: 10,
    DEVICE_CODE_INTERVAL_SEC: 5,
    API_TOKEN_SCOPES_DEFAULT: ["core:read"],
    API_TOKEN_PREFIX: "lfk_",
  } as any;
  registerCliAuthRoutes(server, config);
  return { handlers };
}

describe("cli auth routes", () => {
  it("/auth/cli/device/start returns device and user codes", async () => {
    const { handlers } = makeServer();
    const h = handlers.get("POST /auth/cli/device/start")!;
    let status = 0;
    let body: any = null;
    await h({ ip: "1.1.1.1", body: { email: "a@b.co", deviceName: "dev" } } as any, {
      status(c: number) {
        status = c;
        return this as any;
      },
      json(p: unknown) {
        body = p;
      },
      header() {
        return this as any;
      },
      redirect() {},
    });
    expect(status).toBe(200);
    expect(body?.device_code).toBeTruthy();
    expect(body?.user_code).toBeTruthy();
  });

  it("/auth/cli/device/start 400 on invalid body", async () => {
    const { handlers } = makeServer();
    const h = handlers.get("POST /auth/cli/device/start")!;
    let status = 0;
    let body: any = null;
    await h({ ip: "1.1.1.1", body: {} } as any, {
      status(c: number) {
        status = c;
        return this as any;
      },
      json(p: unknown) {
        body = p;
      },
      header() {
        return this as any;
      },
      redirect() {},
    });
    expect(status).toBe(400);
    expect(body?.code).toBe("BAD_REQUEST");
  });

  it("/auth/cli/device/start returns verification_uri with ADMIN_UI_ORIGIN", async () => {
    const handlers = new Map<string, HttpHandler>();
    const server = {
      post: (p: string, h: HttpHandler) => handlers.set(`POST ${p}`, h),
      get: (p: string, h: HttpHandler) => handlers.set(`GET ${p}`, h),
    } as any;
    const config = {
      DEVICE_CODE_TTL_MIN: 10,
      DEVICE_CODE_INTERVAL_SEC: 5,
      ADMIN_UI_ORIGIN: "https://admin.local",
      API_TOKEN_SCOPES_DEFAULT: ["core:read"],
      API_TOKEN_PREFIX: "lfk_",
    } as any;
    registerCliAuthRoutes(server, config);
    const h = handlers.get("POST /auth/cli/device/start")!;
    let status = 0;
    let body: any = null;
    await h({ ip: "1.1.1.1", body: { email: "a@b.co" } } as any, {
      status(c: number) {
        status = c;
        return this as any;
      },
      json(p: unknown) {
        body = p;
      },
      header() {
        return this as any;
      },
      redirect() {},
    });
    expect(status).toBe(200);
    expect(body?.verification_uri?.startsWith("https://admin.local/cli/device/approve")).toBe(true);
  });

  it("/auth/cli/device/poll returns 400 on invalid body", async () => {
    const { handlers } = makeServer();
    const h = handlers.get("POST /auth/cli/device/poll")!;
    let status = 0;
    let body: any = null;
    await h({ ip: "2.2.2.2", body: {} } as any, {
      status(c: number) {
        status = c;
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
    expect(status).toBe(400);
    expect(body?.code).toBe("BAD_REQUEST");
  });

  it("/auth/cli/device/poll enforces slow_down when called too fast", async () => {
    const { handlers } = makeServer();
    const h = handlers.get("POST /auth/cli/device/poll")!;
    let status = 0;
    let body: any = null;
    const req = { ip: "9.9.9.9", body: { device_code: "abc" } } as any;
    const res = {
      status(c: number) {
        status = c;
        return this as any;
      },
      json(p: any) {
        body = p;
      },
      header() {
        return this as any;
      },
      redirect() {},
    } as any;
    await h(req, res);
    expect(status).toBe(202);
    status = 0;
    body = null;
    await h(req, res);
    expect(status).toBe(429);
    expect(body?.code).toBe("SLOW_DOWN");
  });

  it("/auth/cli/device/poll returns INVALID_CODE, EXPIRED, REVOKED, UNAVAILABLE branches", async () => {
    const req = (code: string) => ({ ip: "5.5.5.5", body: { device_code: code } }) as any;
    const resObj = () => {
      let status = 0 as number;
      let body: any = null;
      const res: any = {
        status(c: number) {
          status = c;
          return res;
        },
        json(p: any) {
          body = p;
        },
        header() {
          return res;
        },
        redirect() {},
      };
      return {
        res,
        get status() {
          return status;
        },
        get body() {
          return body;
        },
      };
    };

    // INVALID_CODE
    state.mode = "null";
    let { handlers } = makeServer();
    let h = handlers.get("POST /auth/cli/device/poll")!;
    let r = resObj();
    await h(req("dc1"), r.res);
    expect(r.status).toBe(400);
    expect(r.body.code).toBe("INVALID_CODE");

    // EXPIRED
    state.mode = "expired";
    ({ handlers } = makeServer());
    h = handlers.get("POST /auth/cli/device/poll")!;
    r = resObj();
    await h(req("dc2"), r.res);
    expect(r.status).toBe(410);
    expect(r.body.code).toBe("EXPIRED");

    // REVOKED
    state.mode = "revoked";
    ({ handlers } = makeServer());
    h = handlers.get("POST /auth/cli/device/poll")!;
    r = resObj();
    await h(req("dc3"), r.res);
    expect(r.status).toBe(410);
    expect(r.body.code).toBe("REVOKED");

    // UNAVAILABLE (approved + token ok but cache empty)
    state.mode = "approved";
    ({ handlers } = makeServer());
    h = handlers.get("POST /auth/cli/device/poll")!;
    r = resObj();
    await h(req("dc4"), r.res);
    expect(r.status).toBe(410);
    expect(r.body.code).toBe("UNAVAILABLE");
  });

  it("/auth/cli/device/approve handles 401, 403, 400, 410, 409, 204", async () => {
    const { handlers } = makeServer();
    const approve = handlers.get("POST /auth/cli/device/approve")!;
    const { requireAdmin } = await import("../../middleware/require-admin.js");

    async function run(body: any) {
      let status = 0;
      let payload: any = null;
      await approve({ body } as any, {
        status(c: number) {
          status = c;
          return this as any;
        },
        json(p: any) {
          payload = p;
        },
        header() {
          return this as any;
        },
        redirect() {},
      });
      return { status, payload };
    }

    // 401 unauthorized
    (requireAdmin as any).mockRejectedValueOnce(Object.assign(new Error("nope"), { status: 401 }));
    let r = await run({ user_code: "x" });
    expect(r.status).toBe(401);

    // 403 insufficient role
    (requireAdmin as any).mockResolvedValueOnce({
      user: { id: "u1", role: "EXECUTOR" },
      session: {},
    });
    r = await run({ user_code: "x" });
    expect(r.status).toBe(403);

    // 400 invalid body
    r = await run({});
    expect(r.status).toBe(400);

    // 410 expired
    const origFind = db.deviceAuth.findFirst;
    db.deviceAuth.findFirst = vi.fn(async () => ({
      id: "d1",
      userId: "u1",
      deviceCodeHash: "h",
      userCodeHash: "uh",
      intervalSec: 5,
      expiresAt: new Date(Date.now() - 1000),
      approvedAt: null,
    })) as any;
    (requireAdmin as any).mockResolvedValueOnce({
      user: { id: "u1", role: "ADMIN" },
      session: {},
    });
    r = await run({ user_code: "x" });
    expect(r.status).toBe(410);

    // 409 already approved
    db.deviceAuth.findFirst = vi.fn(async () => ({
      id: "d1",
      userId: "u1",
      deviceCodeHash: "h",
      userCodeHash: "uh",
      intervalSec: 5,
      expiresAt: new Date(Date.now() + 100000),
      approvedAt: new Date(),
    })) as any;
    r = await run({ user_code: "x" });
    expect(r.status).toBe(409);

    // 204 success
    db.deviceAuth.findFirst = origFind;
    r = await run({ user_code: "x" });
    expect(r.status).toBe(204);
  });

  it("GET /auth/cli/tokens returns tokens for current user", async () => {
    const handlers = new Map<string, HttpHandler>();
    const server = {
      post: (p: string, h: HttpHandler) => handlers.set(`POST ${p}`, h),
      get: (p: string, h: HttpHandler) => handlers.set(`GET ${p}`, h),
    } as any;
    const config = {
      DEVICE_CODE_TTL_MIN: 10,
      DEVICE_CODE_INTERVAL_SEC: 5,
      API_TOKEN_SCOPES_DEFAULT: ["core:read"],
      API_TOKEN_PREFIX: "lfk_",
    } as any;
    db.apiToken.findMany.mockResolvedValueOnce([
      { id: "t1", name: "n1", scopes: ["core:read"], createdAt: new Date() },
    ] as any);
    registerCliAuthRoutes(server, config);
    const h = handlers.get("GET /auth/cli/tokens")!;
    let status = 0;
    let body: any = null;
    await h({} as any, {
      status(c: number) {
        status = c;
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
    expect(status).toBe(200);
    expect(Array.isArray(body?.tokens)).toBe(true);
  });

  it("POST /auth/cli/tokens/revoke validates body and returns 204", async () => {
    const { handlers } = makeServer();
    const h = handlers.get("POST /auth/cli/tokens/revoke")!;
    let status = 0;
    let body: any = null;
    await h({ body: {} } as any, {
      status(c: number) {
        status = c;
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
    expect(status).toBe(400);
    expect(body?.code).toBe("BAD_REQUEST");

    status = 0;
    body = null;
    await h({ body: { tokenId: "t1" } } as any, {
      status(c: number) {
        status = c;
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
    expect(status).toBe(204);
  });

  it("POST /auth/cli/tokens creates a token (201)", async () => {
    const handlers = new Map<string, HttpHandler>();
    const server = {
      post: (p: string, h: HttpHandler) => handlers.set(`POST ${p}`, h),
      get: (p: string, h: HttpHandler) => handlers.set(`GET ${p}`, h),
    } as any;
    const config = {
      DEVICE_CODE_TTL_MIN: 10,
      DEVICE_CODE_INTERVAL_SEC: 5,
      API_TOKEN_SCOPES_DEFAULT: ["core:read"],
      API_TOKEN_PREFIX: "lfk_",
      API_TOKEN_TTL_DAYS: 1,
    } as any;
    registerCliAuthRoutes(server, config);
    const h = handlers.get("POST /auth/cli/tokens")!;
    let status = 0;
    let body: any = null;
    await h({ body: { name: "My Token", scopes: ["core:read"] } } as any, {
      status(c: number) {
        status = c;
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
    expect(status).toBe(201);
    expect(body?.token?.startsWith("lfk_")).toBe(true);
    expect(body?.id).toBe("t1");
  });

  it("POST /auth/cli/tokens/rotate rotates a token (201)", async () => {
    const handlers = new Map<string, HttpHandler>();
    const server = {
      post: (p: string, h: HttpHandler) => handlers.set(`POST ${p}`, h),
      get: (p: string, h: HttpHandler) => handlers.set(`GET ${p}`, h),
    } as any;
    const config = {
      DEVICE_CODE_TTL_MIN: 10,
      DEVICE_CODE_INTERVAL_SEC: 5,
      API_TOKEN_SCOPES_DEFAULT: ["core:read"],
      API_TOKEN_PREFIX: "lfk_",
      API_TOKEN_TTL_DAYS: 1,
    } as any;
    db.apiToken.findUnique.mockResolvedValueOnce({
      id: "t1",
      userId: "u1",
      revokedAt: null,
    } as any);
    registerCliAuthRoutes(server, config);
    const h = handlers.get("POST /auth/cli/tokens/rotate")!;
    let status = 0;
    let body: any = null;
    await h({ body: { tokenId: "t1" } } as any, {
      status(c: number) {
        status = c;
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
    expect(status).toBe(201);
    expect(body?.token?.startsWith("lfk_")).toBe(true);
    expect(body?.id).toBe("t1");
  });
});
