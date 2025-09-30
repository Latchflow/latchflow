import { describe, it, expect, vi, beforeEach } from "vitest";
import type { HttpHandler } from "../../src/http/http-server.js";
import { createResponseCapture } from "@tests/helpers/response";

// Prisma-like mock
const db = {
  triggerDefinition: {
    findMany: vi.fn(async () => []),
    findUnique: vi.fn(async () => null),
    create: vi.fn(async (..._args: any[]) => ({})),
    update: vi.fn(async (..._args: any[]) => ({})),
    delete: vi.fn(async (..._args: any[]) => ({})),
  },
  pluginCapability: {
    findUnique: vi.fn(async () => null),
  },
  triggerEvent: { count: vi.fn(async () => 0) },
  pipelineTrigger: { count: vi.fn(async () => 0) },
};

vi.mock("../../src/db/db.js", () => ({ getDb: () => db }));

// Permission path relies on requireSession; allow ADMIN through
vi.mock("../../src/middleware/require-session.js", () => ({
  requireSession: vi.fn(async () => ({ user: { id: "u1", role: "ADMIN" } })),
}));

// Stub ChangeLog appends
vi.mock("../../src/history/changelog.js", () => ({
  appendChangeLog: vi.fn(async () => ({ id: "cl1", version: 1 })),
}));

function makeServer() {
  const handlers = new Map<string, HttpHandler>();
  const server = {
    get: (p: string, h: HttpHandler) => handlers.set(`GET ${p}`, h),
    post: (p: string, h: HttpHandler) => handlers.set(`POST ${p}`, h),
    patch: (p: string, h: HttpHandler) => handlers.set(`PATCH ${p}`, h),
    delete: (p: string, h: HttpHandler) => handlers.set(`DELETE ${p}`, h),
  } as any;
  return { handlers, server };
}

describe("triggers admin routes (integration)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    for (const model of Object.values(db) as any[]) {
      for (const fn of Object.values(model) as any[]) {
        if (typeof fn?.mockReset === "function") fn.mockReset();
      }
    }
  });

  it("create → enable toggle → list filters → delete", async () => {
    const { handlers, server } = makeServer();
    const { registerTriggerAdminRoutes } = await import("../../src/routes/admin/triggers.js");
    const fire = vi.fn(async () => {});
    registerTriggerAdminRoutes(server, {
      fireTriggerOnce: fire,
      config: {
        HISTORY_SNAPSHOT_INTERVAL: 20,
        HISTORY_MAX_CHAIN_DEPTH: 200,
        SYSTEM_USER_ID: "sys",
      } as any,
    });

    // Create
    db.pluginCapability.findUnique.mockResolvedValueOnce({
      id: "cap1",
      kind: "TRIGGER",
      isEnabled: true,
    } as any);
    db.triggerDefinition.create.mockResolvedValueOnce({
      id: "t1",
      name: "Cron",
      capabilityId: "cap1",
      config: {},
      isEnabled: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    } as any);
    const rcCreate = createResponseCapture();
    await handlers.get("POST /triggers")!(
      { body: { name: "Cron", capabilityId: "cap1", config: {} } } as any,
      rcCreate.res,
    );
    expect(rcCreate.status).toBe(201);

    // Enable toggle (disable now)
    db.triggerDefinition.update.mockResolvedValueOnce({ id: "t1" } as any);
    const rcUpdate = createResponseCapture();
    await handlers.get("PATCH /triggers/:id")!(
      { params: { id: "t1" }, body: { isEnabled: false } } as any,
      rcUpdate.res,
    );
    expect(rcUpdate.status).toBe(204);

    // List with filter
    db.triggerDefinition.findMany.mockResolvedValueOnce([] as any);
    const rcList = createResponseCapture();
    await handlers.get("GET /triggers")!(
      { query: { pluginId: "p1", capabilityKey: "cron", q: "cr" } } as any,
      rcList.res,
    );
    const args = (db.triggerDefinition.findMany as any).mock.calls[0]?.[0];
    const cap = args?.where?.capability;
    const pluginId = cap?.pluginId ?? cap?.is?.pluginId;
    const keyContains = cap?.key?.contains ?? cap?.is?.key?.contains;
    expect(pluginId).toBe("p1");
    expect(keyContains).toBe("cron");
    expect(args?.where?.name?.contains).toBe("cr");

    // Delete
    db.triggerEvent.count.mockResolvedValueOnce(0 as any);
    db.pipelineTrigger.count.mockResolvedValueOnce(0 as any);
    db.triggerDefinition.delete.mockResolvedValueOnce({} as any);
    const rcDelete = createResponseCapture();
    await handlers.get("DELETE /triggers/:id")!({ params: { id: "t1" } } as any, rcDelete.res);
    expect(rcDelete.status).toBe(204);
  }, 10_000);
});
