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
vi.mock("../../middleware/require-admin.js", () => ({
  requireAdmin: vi.fn(async () => ({ user: { id: "u1", roles: ["ADMIN"] }, session: {} })),
}));

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
});
