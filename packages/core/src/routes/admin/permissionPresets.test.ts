import { describe, it, expect, beforeEach, vi } from "vitest";
import type { HttpHandler } from "../../http/http-server.js";
import { registerPermissionPresetAdminRoutes } from "./permissionPresets.js";
import { createResponseCapture } from "@tests/helpers/response";

const db = {
  permissionPreset: {
    findMany: vi.fn(async () => []),
    findUnique: vi.fn(async () => null),
    create: vi.fn(async (..._args: any[]) => ({})),
    update: vi.fn(async (..._args: any[]) => ({})),
    delete: vi.fn(async (..._args: any[]) => ({})),
    count: vi.fn(async () => 0),
  },
  user: {
    findMany: vi.fn(async () => []),
    findUnique: vi.fn(async () => null),
    count: vi.fn(async () => 0),
  },
  changeLog: {
    findMany: vi.fn(async () => []),
  },
};

vi.mock("../../db/db.js", () => ({ getDb: () => db }));

const historyMocks = vi.hoisted(() => ({
  appendChangeLog: vi.fn(async () => ({
    version: 2,
    isSnapshot: false,
    hash: "hash",
    changeNote: null,
    changedPath: null,
    changeKind: "UPDATE_PARENT",
    createdAt: new Date("2024-01-01T00:00:00.000Z"),
    actorType: "USER",
    actorUserId: "user1",
    actorInvocationId: null,
    actorActionDefinitionId: null,
    onBehalfOfUserId: null,
  })),
  materializeVersion: vi.fn(async () => ({
    name: "Test Preset",
    rules: [],
  })),
}));

vi.mock("../../history/changelog.js", () => historyMocks);

vi.mock("../../middleware/require-admin-or-api-token.js", () => ({
  requireAdminOrApiToken: () => (handler: any) => handler,
}));

vi.mock("../../authz/cache.js", () => ({
  invalidateCompiledPermissions: vi.fn(),
}));

vi.mock("../../authz/authorize.js", () => ({
  authorizeRequest: vi.fn(() => ({
    decision: { ok: true, reason: "ADMIN" },
    rulesHash: "test-hash",
  })),
}));

vi.mock("../../authz/context.js", () => ({
  buildContext: vi.fn(() => ({ userId: "test-user", role: "ADMIN" })),
}));

vi.mock("../../observability/metrics.js", () => ({
  recordAuthzSimulation: vi.fn(),
}));

function makeServer() {
  const handlers = new Map<string, HttpHandler>();
  const server = {
    get: (p: string, h: HttpHandler) => handlers.set(`GET ${p}`, h),
    post: (p: string, h: HttpHandler) => handlers.set(`POST ${p}`, h),
    patch: (p: string, h: HttpHandler) => handlers.set(`PATCH ${p}`, h),
    delete: (p: string, h: HttpHandler) => handlers.set(`DELETE ${p}`, h),
  } as any;
  registerPermissionPresetAdminRoutes(server, {
    config: {
      HISTORY_SNAPSHOT_INTERVAL: 20,
      HISTORY_MAX_CHAIN_DEPTH: 200,
      SYSTEM_USER_ID: "sys",
    } as any,
  });
  return { handlers };
}

function resetDbMocks() {
  for (const model of Object.values(db) as any[]) {
    for (const fn of Object.values(model) as any[]) {
      if (typeof fn?.mockReset === "function") fn.mockReset();
    }
  }
}

describe("permission presets admin routes", () => {
  beforeEach(() => {
    resetDbMocks();
    historyMocks.appendChangeLog.mockClear();
    historyMocks.materializeVersion.mockClear();
  });

  it("registers routes without errors", () => {
    const { handlers } = makeServer();
    expect(handlers.size).toBeGreaterThan(0);
    expect(handlers.has("GET /admin/permissions/presets")).toBe(true);
    expect(handlers.has("POST /admin/permissions/presets")).toBe(true);
    expect(handlers.has("POST /admin/permissions/simulate")).toBe(true);
  });

  it("GET /admin/permissions/presets returns list", async () => {
    db.permissionPreset.findMany.mockResolvedValue([
      {
        id: "preset-1",
        name: "Test Preset",
        version: 1,
        rules: [],
        createdAt: new Date(),
        updatedAt: new Date(),
        createdBy: "user-1",
        updatedBy: null,
      },
    ]);

    const { handlers } = makeServer();
    const handler = handlers.get("GET /admin/permissions/presets");
    expect(handler).toBeDefined();

    const req = {
      query: {},
      user: { id: "admin" },
    } as any;
    const res = createResponseCapture();

    await handler!(req, res.res);

    expect(res.body).toMatchObject({
      items: expect.arrayContaining([
        expect.objectContaining({
          id: "preset-1",
          name: "Test Preset",
        }),
      ]),
    });
  });

  it("POST /admin/permissions/simulate validates input", async () => {
    db.user.findUnique.mockResolvedValue({
      id: "test-user",
      role: "ADMIN",
      isActive: true,
      permissionsHash: "test-hash",
      directPermissions: null,
      permissionPresetId: null,
      permissionPreset: null,
    });

    const { handlers } = makeServer();
    const handler = handlers.get("POST /admin/permissions/simulate");
    expect(handler).toBeDefined();

    const req = {
      body: {
        userId: "test-user",
        method: "GET",
        path: "/admin/bundles",
      },
      user: { id: "admin" },
    } as any;
    const res = createResponseCapture();

    await handler!(req, res.res);

    expect(res.body).toMatchObject({
      decision: expect.any(String),
      routeSignature: "GET /admin/bundles",
      userId: "test-user",
    });
  });
});