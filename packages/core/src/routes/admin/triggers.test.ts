import { describe, it, expect, vi, beforeEach } from "vitest";
import { registerTriggerAdminRoutes } from "../../routes/admin/triggers.js";
import type { HttpHandler } from "../../http/http-server.js";

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
  apiToken: { findUnique: vi.fn(async () => null), update: vi.fn(async () => ({})) },
  user: { findUnique: vi.fn(async () => null) },
};

vi.mock("../../db/db.js", () => ({ getDb: () => db }));

// Default: requireSession passes
vi.mock("../../middleware/require-session.js", () => ({
  requireSession: vi.fn(async () => ({ user: { id: "u1", role: "ADMIN" } })),
}));

// Stub ChangeLog appends
vi.mock("../../history/changelog.js", () => ({
  appendChangeLog: vi.fn(async () => ({ id: "cl1", version: 1 })),
}));

async function makeServer() {
  const handlers = new Map<string, HttpHandler>();
  const server = {
    get: (p: string, h: HttpHandler) => handlers.set(`GET ${p}`, h),
    post: (p: string, h: HttpHandler) => handlers.set(`POST ${p}`, h),
    patch: (p: string, h: HttpHandler) => handlers.set(`PATCH ${p}`, h),
    delete: (p: string, h: HttpHandler) => handlers.set(`DELETE ${p}`, h),
  } as any;
  registerTriggerAdminRoutes(server, {
    fireTriggerOnce: async () => {},
    config: {
      HISTORY_SNAPSHOT_INTERVAL: 20,
      HISTORY_MAX_CHAIN_DEPTH: 200,
      SYSTEM_USER_ID: "sys",
    } as any,
  });
  return { handlers };
}

function resCapture() {
  let status = 0;
  let body: any = null;
  const headers: Record<string, string | string[]> = {};
  const res = {
    status(c: number) {
      status = c;
      return this as any;
    },
    json(p: any) {
      body = p;
    },
    header(name: string, value: any) {
      headers[name] = value;
      return this as any;
    },
    redirect() {},
    sendStream() {},
    sendBuffer() {},
  } as any;
  return {
    res,
    get status() {
      return status;
    },
    get body() {
      return body;
    },
    get headers() {
      return headers;
    },
  };
}

describe("triggers routes", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    for (const model of Object.values(db) as any[]) {
      for (const fn of Object.values(model) as any[]) {
        if (typeof fn?.mockReset === "function") fn.mockReset();
      }
    }
  });
  it("GET /triggers returns items", async () => {
    db.triggerDefinition.findMany.mockResolvedValueOnce([
      {
        id: "t1",
        name: "Cron schedule",
        capabilityId: "cap1",
        config: {},
        isEnabled: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ] as any);
    const { handlers } = await makeServer();
    const h = handlers.get("GET /triggers")!;
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
      sendStream() {},
      sendBuffer() {},
    });
    expect(status).toBe(200);
    expect(Array.isArray(body?.items)).toBe(true);
    expect(body.items[0]?.id).toBe("t1");
  });

  it("POST /triggers validates capability and returns 400 when invalid", async () => {
    const { handlers } = await makeServer();
    const h = handlers.get("POST /triggers")!;
    const rc = resCapture();
    await h({ body: { name: "n1", capabilityId: "capX", config: {} } } as any, rc.res);
    expect(rc.status).toBe(400);
    expect(rc.body?.code).toBe("INVALID_CAPABILITY");
  });

  it("POST /triggers creates trigger and returns 201", async () => {
    const { handlers } = await makeServer();
    db.pluginCapability.findUnique.mockResolvedValueOnce({
      id: "cap1",
      kind: "TRIGGER",
      isEnabled: true,
    } as any);
    db.triggerDefinition.create.mockResolvedValueOnce({
      id: "t1",
      name: "n1",
      capabilityId: "cap1",
      config: {},
      isEnabled: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    } as any);
    const h = handlers.get("POST /triggers")!;
    const rc = resCapture();
    await h({ body: { name: "n1", capabilityId: "cap1", config: {} } } as any, rc.res);
    expect(rc.status).toBe(201);
    expect(rc.body?.id).toBe("t1");
    expect(db.triggerDefinition.create).toHaveBeenCalled();
  });

  it("GET /triggers/:id 404 when missing", async () => {
    const { handlers } = await makeServer();
    db.triggerDefinition.findUnique.mockResolvedValueOnce(null as any);
    const h = handlers.get("GET /triggers/:id")!;
    const rc = resCapture();
    await h({ params: { id: "missing" } } as any, rc.res);
    expect(rc.status).toBe(404);
  });

  it("POST /triggers/:id updates and returns 204", async () => {
    const { handlers } = await makeServer();
    db.triggerDefinition.update.mockResolvedValueOnce({ id: "t1" } as any);
    const h = handlers.get("POST /triggers/:id")!;
    const rc = resCapture();
    await h({ params: { id: "t1" }, body: { isEnabled: false } } as any, rc.res);
    expect(rc.status).toBe(204);
    const args = (db.triggerDefinition.update as any).mock.calls[0]?.[0]?.data;
    expect(args).toHaveProperty("isEnabled", false);
    expect(args).toHaveProperty("updatedBy");
  });

  it("DELETE /triggers/:id returns 409 when in use", async () => {
    const { handlers } = await makeServer();
    db.triggerEvent.count.mockResolvedValueOnce(1 as any);
    db.pipelineTrigger.count.mockResolvedValueOnce(0 as any);
    const h = handlers.get("DELETE /triggers/:id")!;
    const rc = resCapture();
    await h({ params: { id: "t1" } } as any, rc.res);
    expect(rc.status).toBe(409);
  });

  it("POST /triggers/:id/test-fire returns 202 and calls runner", async () => {
    const handlers = new Map<string, HttpHandler>();
    const server = {
      get: (p: string, h: HttpHandler) => handlers.set(`GET ${p}`, h),
      post: (p: string, h: HttpHandler) => handlers.set(`POST ${p}`, h),
      patch: (p: string, h: HttpHandler) => handlers.set(`PATCH ${p}`, h),
      delete: (p: string, h: HttpHandler) => handlers.set(`DELETE ${p}`, h),
    } as any;
    const fire = vi.fn(async () => {});
    registerTriggerAdminRoutes(server, {
      fireTriggerOnce: fire,
      config: {
        HISTORY_SNAPSHOT_INTERVAL: 20,
        HISTORY_MAX_CHAIN_DEPTH: 200,
        SYSTEM_USER_ID: "sys",
      } as any,
    });
    const h = handlers.get("POST /triggers/:id/test-fire")!;
    const rc = resCapture();
    await h({ params: { id: "t1" }, body: { context: { a: 1 } } } as any, rc.res);
    expect(rc.status).toBe(202);
    expect(fire).toHaveBeenCalledWith("t1", { a: 1 });
  });
});
