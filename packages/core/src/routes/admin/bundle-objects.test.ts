import { describe, it, expect, vi, beforeEach } from "vitest";
import type { HttpHandler } from "../../http/http-server.js";
import { createResponseCapture } from "@tests/helpers/response";

const db = {
  bundleObject: {
    findMany: vi.fn(async () => []),
    findFirst: vi.fn(async () => null),
    findUnique: vi.fn(async () => null),
    upsert: vi.fn(async () => ({})),
    update: vi.fn(async () => ({})),
    deleteMany: vi.fn(async () => ({ count: 1 })),
  },
  file: {
    findMany: vi.fn(async () => []),
  },
};

vi.mock("../../db/db.js", () => ({ getDb: () => db }));

const historyMocks = vi.hoisted(() => ({
  appendChangeLog: vi.fn(async () => ({
    version: 1,
    isSnapshot: true,
    hash: "hash",
    changeNote: null,
    changedPath: "/objects",
    changeKind: "UPDATE_CHILD",
    createdAt: new Date("2024-01-01T00:00:00.000Z"),
    actorType: "USER",
    actorUserId: "admin",
    actorInvocationId: null,
    actorActionDefinitionId: null,
    onBehalfOfUserId: null,
  })),
  materializeVersion: vi.fn(),
}));

const appendChangeLog = historyMocks.appendChangeLog;

vi.mock("../../history/changelog.js", () => historyMocks);

vi.mock("../../middleware/require-session.js", () => ({
  requireSession: vi.fn(async () => ({ user: { id: "admin", role: "ADMIN" } })),
}));

// Mock authorization modules
vi.mock("../../authz/authorize.js", () => ({
  authorizeRequest: vi.fn(() => ({
    decision: { ok: true, reason: "RULE_MATCH" },
    rulesHash: "hash",
  })),
}));

vi.mock("../../authz/featureFlags.js", () => ({
  getAuthzMode: vi.fn(() => "off"),
  getSystemUserId: vi.fn(() => "system"),
  isAdmin2faRequired: vi.fn(() => false),
  getReauthWindowMs: vi.fn(() => 15 * 60 * 1000),
}));

vi.mock("../../authz/decisionLog.js", () => ({
  logDecision: vi.fn(),
}));

vi.mock("../../observability/metrics.js", () => ({
  recordAuthzDecision: vi.fn(),
  recordAuthzTwoFactor: vi.fn(),
}));

function makeServer(overrides?: { scheduler?: { schedule: ReturnType<typeof vi.fn> } }) {
  const handlers = new Map<string, HttpHandler>();
  const server = {
    get: (p: string, h: HttpHandler) => handlers.set(`GET ${p}`, h),
    post: (p: string, h: HttpHandler) => handlers.set(`POST ${p}`, h),
    patch: (p: string, h: HttpHandler) => handlers.set(`PATCH ${p}`, h),
    delete: (p: string, h: HttpHandler) => handlers.set(`DELETE ${p}`, h),
  } as any;
  const scheduler =
    overrides?.scheduler ??
    ({ schedule: vi.fn(), scheduleForFiles: vi.fn(), getStatus: vi.fn() } as any);
  return { handlers, server, scheduler };
}

describe("bundle-objects admin routes", () => {
  beforeEach(() => {
    Object.values(db.bundleObject).forEach((fn: any) => fn?.mockReset?.());
    Object.values(db.file).forEach((fn: any) => fn?.mockReset?.());
    appendChangeLog.mockClear();
  });

  it("GET /bundles/:bundleId/objects lists with file metadata and cursor", async () => {
    const { handlers, server, scheduler } = makeServer();
    const { registerBundleObjectsAdminRoutes } = await import("./bundle-objects.js");
    registerBundleObjectsAdminRoutes(server, {
      scheduler,
      config: {
        HISTORY_SNAPSHOT_INTERVAL: 20,
        HISTORY_MAX_CHAIN_DEPTH: 200,
        SYSTEM_USER_ID: "sys",
      } as any,
    });
    const now = new Date().toISOString();
    db.bundleObject.findMany.mockResolvedValueOnce([
      {
        id: "bo1",
        bundleId: "11111111-1111-1111-1111-111111111111",
        fileId: "f1",
        path: "docs/a.txt",
        sortOrder: 1,
        required: false,
        addedAt: now,
        file: {
          id: "f1",
          key: "docs/a.txt",
          size: BigInt(10),
          contentType: "text/plain",
          metadata: { lang: "en" },
          contentHash: "a".repeat(64),
          etag: null,
          updatedAt: now,
        },
      },
    ] as any);
    const h = handlers.get("GET /bundles/:bundleId/objects")!;
    const rc = createResponseCapture();
    await h(
      {
        params: { bundleId: "11111111-1111-1111-1111-111111111111" },
        query: { limit: "1" },
      } as any,
      rc.res,
    );
    expect(rc.status).toBe(200);
    expect(rc.body?.items?.[0]?.bundleObject?.id).toBe("bo1");
    expect(rc.body?.nextCursor).toBeTruthy();
  });

  it("POST /bundles/:bundleId/objects attaches items and records change", async () => {
    const { handlers, server, scheduler } = makeServer();
    const { registerBundleObjectsAdminRoutes } = await import("./bundle-objects.js");
    registerBundleObjectsAdminRoutes(server, {
      scheduler,
      config: {
        HISTORY_SNAPSHOT_INTERVAL: 20,
        HISTORY_MAX_CHAIN_DEPTH: 200,
        SYSTEM_USER_ID: "sys",
      } as any,
    });
    db.file.findMany.mockResolvedValueOnce([{ id: "f1", key: "k1.txt" }] as any);
    db.bundleObject.findFirst.mockResolvedValueOnce({ sortOrder: 4 } as any);
    db.bundleObject.upsert.mockResolvedValueOnce({
      id: "bo1",
      bundleId: "b1",
      fileId: "f1",
      path: "k1.txt",
      sortOrder: 5,
      required: false,
      addedAt: new Date().toISOString(),
    } as any);
    const h = handlers.get("POST /bundles/:bundleId/objects")!;
    const rc = createResponseCapture();
    await h(
      {
        params: { bundleId: "b1" },
        body: { items: [{ fileId: "f1" }] },
      } as any,
      rc.res,
    );
    expect(rc.status).toBe(201);
    expect(scheduler.schedule).toHaveBeenCalledWith("b1");
    expect(appendChangeLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      "BUNDLE",
      "b1",
      expect.anything(),
      expect.objectContaining({ changeKind: "UPDATE_CHILD" }),
    );
  });

  it("PATCH /bundles/:bundleId/objects/:id updates fields via PATCH and logs history", async () => {
    const { handlers, server, scheduler } = makeServer();
    const { registerBundleObjectsAdminRoutes } = await import("./bundle-objects.js");
    registerBundleObjectsAdminRoutes(server, {
      scheduler,
      config: {
        HISTORY_SNAPSHOT_INTERVAL: 20,
        HISTORY_MAX_CHAIN_DEPTH: 200,
        SYSTEM_USER_ID: "sys",
      } as any,
    });
    db.bundleObject.findUnique.mockResolvedValueOnce({ bundleId: "b1" } as any);
    const h = handlers.get("PATCH /bundles/:bundleId/objects/:id")!;
    const rc = createResponseCapture();
    await h(
      {
        params: { bundleId: "b1", id: "bo1" },
        body: { path: "new.txt", required: true },
      } as any,
      rc.res,
    );
    expect(rc.status).toBe(204);
    expect(db.bundleObject.update).toHaveBeenCalledWith({
      where: { id: "bo1" },
      data: expect.objectContaining({ path: "new.txt", required: true, updatedBy: "admin" }),
    });
    expect(appendChangeLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      "BUNDLE",
      "b1",
      expect.anything(),
      expect.objectContaining({ changeKind: "UPDATE_CHILD" }),
    );
  });

  it("DELETE /bundles/:bundleId/objects/:id detaches and records removal", async () => {
    const { handlers, server, scheduler } = makeServer();
    const { registerBundleObjectsAdminRoutes } = await import("./bundle-objects.js");
    registerBundleObjectsAdminRoutes(server, {
      scheduler,
      config: {
        HISTORY_SNAPSHOT_INTERVAL: 20,
        HISTORY_MAX_CHAIN_DEPTH: 200,
        SYSTEM_USER_ID: "sys",
      } as any,
    });
    db.bundleObject.deleteMany.mockResolvedValueOnce({ count: 1 } as any);
    const h = handlers.get("DELETE /bundles/:bundleId/objects/:id")!;
    const rc = createResponseCapture();
    await h(
      {
        params: { bundleId: "b1", id: "bo1" },
      } as any,
      rc.res,
    );
    expect(rc.status).toBe(204);
    expect(scheduler.schedule).toHaveBeenCalledWith("b1");
    expect(appendChangeLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      "BUNDLE",
      "b1",
      expect.anything(),
      expect.objectContaining({ changeKind: "REMOVE_CHILD" }),
    );
  });
});
