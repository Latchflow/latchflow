import { describe, it, expect, vi } from "vitest";
import { registerCliAuthRoutes } from "../../src/routes/auth/cli.js";
import type { HttpHandler } from "../../src/http/http-server.js";

vi.mock("../../src/db.js", () => {
  return {
    getDb: () => ({
      user: { upsert: vi.fn(async ({ create }: any) => ({ id: "u1", email: create.email })) },
      deviceAuth: { create: vi.fn(async (args: any) => ({ ...args.data })) },
      apiToken: {
        create: vi.fn(async () => ({ id: "t1", scopes: ["core:read"], expiresAt: null })),
        findUnique: vi.fn(async () => ({ id: "t1", scopes: ["core:read"], revokedAt: null })),
        findMany: vi.fn(async () => []),
        updateMany: vi.fn(async () => ({})),
      },
    }),
  };
});

vi.mock("../../src/middleware/require-admin.js", () => ({
  requireAdmin: vi.fn(async () => ({
    user: { id: "u1", email: "e", roles: ["ADMIN"] },
    session: {},
  })),
}));

describe("cli auth routes", () => {
  it("/auth/cli/device/start returns device and user codes", async () => {
    const handlers = new Map<string, HttpHandler>();
    const server = {
      post: (p: string, h: HttpHandler) => handlers.set(`POST ${p}`, h),
      get: (p: string, h: HttpHandler) => handlers.set(`GET ${p}`, h),
    } as any;
    const config = {
      DEVICE_CODE_TTL_MIN: 10,
      DEVICE_CODE_INTERVAL_SEC: 5,
      ADMIN_UI_ORIGIN: undefined,
      API_TOKEN_SCOPES_DEFAULT: ["core:read"],
      API_TOKEN_PREFIX: "lfk_",
    } as any;
    registerCliAuthRoutes(server, config);
    const handler = handlers.get("POST /auth/cli/device/start")!;
    let status = 0;
    let body: any = null;
    await handler({ ip: "1.1.1.1", body: { email: "a@b.co", deviceName: "dev" } } as any, {
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
    const handlers = new Map<string, HttpHandler>();
    const server = {
      post: (p: string, h: HttpHandler) => handlers.set(`POST ${p}`, h),
      get: (p: string, h: HttpHandler) => handlers.set(`GET ${p}`, h),
    } as any;
    const config = {
      DEVICE_CODE_TTL_MIN: 10,
      DEVICE_CODE_INTERVAL_SEC: 5,
      ADMIN_UI_ORIGIN: undefined,
      API_TOKEN_SCOPES_DEFAULT: ["core:read"],
      API_TOKEN_PREFIX: "lfk_",
    } as any;
    registerCliAuthRoutes(server, config);
    const handler = handlers.get("POST /auth/cli/device/start")!;
    let status = 0;
    let body: any = null;
    await handler({ ip: "1.1.1.1", body: {} } as any, {
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
    const handler = handlers.get("POST /auth/cli/device/start")!;
    let status = 0;
    let body: any = null;
    await handler({ ip: "1.1.1.1", body: { email: "a@b.co" } } as any, {
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
});
