import { describe, it, expect, vi } from "vitest";
import { registerCliAuthRoutes } from "../../../src/routes/auth/cli.js";
import type { HttpHandler } from "../../../src/http/http-server.js";
import { sha256Hex } from "../../../src/auth/tokens.js";

vi.mock("../../../src/middleware/require-admin.js", () => ({
  requireAdmin: vi.fn(async () => ({ user: { id: "u1", roles: ["ADMIN"] }, session: {} })),
}));

vi.mock("../../../src/db.js", () => {
  const state = { mode: "pending" as "pending" | "null" | "expired" | "approved" | "revoked" };
  const deviceAuth = {
    findFirst: vi.fn(async ({ where: { deviceCodeHash } }: any) => {
      if (state.mode === "null") return null;
      if (state.mode === "expired")
        return {
          id: "d1",
          deviceCodeHash,
          intervalSec: 5,
          expiresAt: new Date(Date.now() - 1000),
          approvedAt: null,
          tokenId: null,
        };
      if (state.mode === "approved")
        return {
          id: "d1",
          deviceCodeHash,
          intervalSec: 5,
          expiresAt: new Date(Date.now() + 60000),
          approvedAt: new Date(),
          tokenId: "t1",
        };
      if (state.mode === "revoked")
        return {
          id: "d1",
          deviceCodeHash,
          intervalSec: 5,
          expiresAt: new Date(Date.now() + 60000),
          approvedAt: new Date(),
          tokenId: "t1",
        };
      return {
        id: "d1",
        deviceCodeHash,
        intervalSec: 5,
        expiresAt: new Date(Date.now() + 60000),
        approvedAt: null,
        tokenId: null,
      };
    }),
    create: vi.fn(async (args: any) => ({ ...args.data })),
    update: vi.fn(async () => ({})),
  };
  const apiToken = {
    create: vi.fn(async () => ({ id: "t1", scopes: ["core:read"], expiresAt: null })),
    findUnique: vi.fn(async () =>
      state.mode === "revoked"
        ? { id: "t1", scopes: ["core:read"], revokedAt: new Date() }
        : { id: "t1", scopes: ["core:read"], revokedAt: null },
    ),
  };
  const user = { upsert: vi.fn(async ({ create }: any) => ({ id: "u1", email: create.email })) };
  return { getDb: () => ({ deviceAuth, apiToken, user }), __state: state };
});

describe("cli auth more", () => {
  it("poll enforces slow_down when called too fast", async () => {
    const handlers = new Map<string, HttpHandler>();
    const server = {
      post: (p: string, h: HttpHandler) => handlers.set(`POST ${p}`, h),
      get: () => {},
    } as any;
    const config = {
      DEVICE_CODE_TTL_MIN: 10,
      DEVICE_CODE_INTERVAL_SEC: 5,
      API_TOKEN_SCOPES_DEFAULT: ["core:read"],
      API_TOKEN_PREFIX: "lfk_",
    } as any;
    registerCliAuthRoutes(server, config);
    const handler = handlers.get("POST /auth/cli/device/poll")!;
    let status = 0;
    let body: any = null;
    const device_code = "abc";
    const req = { ip: "9.9.9.9", body: { device_code } } as any;
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
    await handler(req, res);
    expect(status).toBe(202);
    // Immediately poll again to trigger slow_down
    status = 0;
    body = null;
    await handler(req, res);
    expect(status).toBe(429);
    expect(body?.code).toBe("SLOW_DOWN");
  });

  it("poll returns INVALID_CODE, EXPIRED, REVOKED, UNAVAILABLE branches", async () => {
    const { __state } = (await import("../../../src/db.js")) as any;
    const makeServer = () => {
      const handlers = new Map<string, HttpHandler>();
      const server = {
        post: (p: string, h: HttpHandler) => handlers.set(`POST ${p}`, h),
        get: () => {},
      } as any;
      const config = {
        DEVICE_CODE_TTL_MIN: 10,
        DEVICE_CODE_INTERVAL_SEC: 5,
        API_TOKEN_SCOPES_DEFAULT: ["core:read"],
        API_TOKEN_PREFIX: "lfk_",
      } as any;
      registerCliAuthRoutes(server, config);
      return { handlers };
    };
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
    __state.mode = "null";
    let srv = makeServer();
    let h = srv.handlers.get("POST /auth/cli/device/poll")!;
    let r = resObj();
    await h(req("dc1"), r.res);
    expect(r.status).toBe(400);
    expect(r.body.code).toBe("INVALID_CODE");

    // EXPIRED
    __state.mode = "expired";
    srv = makeServer();
    h = srv.handlers.get("POST /auth/cli/device/poll")!;
    r = resObj();
    await h(req("dc2"), r.res);
    expect(r.status).toBe(410);
    expect(r.body.code).toBe("EXPIRED");

    // REVOKED
    __state.mode = "revoked";
    srv = makeServer();
    h = srv.handlers.get("POST /auth/cli/device/poll")!;
    r = resObj();
    await h(req("dc3"), r.res);
    expect(r.status).toBe(410);
    expect(r.body.code).toBe("REVOKED");

    // UNAVAILABLE (approved + token ok but cache empty)
    __state.mode = "approved";
    srv = makeServer();
    h = srv.handlers.get("POST /auth/cli/device/poll")!;
    r = resObj();
    await h(req("dc4"), r.res);
    expect(r.status).toBe(410);
    expect(r.body.code).toBe("UNAVAILABLE");
  });
});
