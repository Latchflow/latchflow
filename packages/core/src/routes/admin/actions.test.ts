import { describe, it, expect, vi, beforeEach } from "vitest";
import { registerActionAdminRoutes } from "./actions.js";
import type { HttpHandler } from "../../http/http-server.js";
import { createResponseCapture } from "@tests/helpers/response";

const db = {
  actionDefinition: {
    findMany: vi.fn(async () => []),
    findUnique: vi.fn(async () => null),
    create: vi.fn(async (..._args: any[]) => ({})),
    update: vi.fn(async (..._args: any[]) => ({})),
    delete: vi.fn(async (..._args: any[]) => ({})),
  },
  pluginCapability: {
    findUnique: vi.fn(async () => null),
  },
  actionInvocation: {
    count: vi.fn(async () => 0),
  },
  pipelineStep: {
    count: vi.fn(async () => 0),
  },
  changeLog: {
    findMany: vi.fn(async () => []),
    findFirst: vi.fn(async () => null),
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
    actorUserId: "u1",
    actorInvocationId: null,
    actorActionDefinitionId: null,
    onBehalfOfUserId: null,
  })),
  materializeVersion: vi.fn(async () => ({ id: "a1", config: { foo: "bar" } })),
}));

const appendChangeLog = historyMocks.appendChangeLog;
const materializeVersion = historyMocks.materializeVersion;

vi.mock("../../history/changelog.js", () => historyMocks);

vi.mock("../../middleware/require-session.js", () => ({
  requireSession: vi.fn(async () => ({ user: { id: "admin", role: "ADMIN" } })),
}));

async function makeServer(overrides?: {
  queue?: {
    enqueueAction: ReturnType<typeof vi.fn>;
    consumeActions?: ReturnType<typeof vi.fn>;
    stop?: ReturnType<typeof vi.fn>;
  };
}) {
  const handlers = new Map<string, HttpHandler>();
  const server = {
    get: (p: string, h: HttpHandler) => handlers.set(`GET ${p}`, h),
    post: (p: string, h: HttpHandler) => handlers.set(`POST ${p}`, h),
    patch: (p: string, h: HttpHandler) => handlers.set(`PATCH ${p}`, h),
    delete: (p: string, h: HttpHandler) => handlers.set(`DELETE ${p}`, h),
  } as any;
  const queue =
    overrides?.queue ??
    ({
      enqueueAction: vi.fn(async () => {}),
      consumeActions: vi.fn(async () => {}),
      stop: vi.fn(async () => {}),
    } as const);
  registerActionAdminRoutes(server, {
    queue,
    config: {
      HISTORY_SNAPSHOT_INTERVAL: 20,
      HISTORY_MAX_CHAIN_DEPTH: 200,
      SYSTEM_USER_ID: "sys",
    } as any,
  });
  return { handlers, queue };
}

function resetDbMocks() {
  for (const model of Object.values(db) as any[]) {
    for (const fn of Object.values(model) as any[]) {
      if (typeof fn?.mockReset === "function") fn.mockReset();
    }
  }
}

describe("actions admin routes", () => {
  beforeEach(() => {
    resetDbMocks();
    appendChangeLog.mockClear();
    materializeVersion.mockClear();
  });

  it("GET /actions returns items", async () => {
    db.actionDefinition.findMany.mockResolvedValueOnce([
      {
        id: "a1",
        name: "Action",
        capabilityId: "cap1",
        config: { foo: "bar" },
        isEnabled: true,
        createdAt: new Date("2024-01-01T12:00:00Z"),
        updatedAt: new Date("2024-01-02T12:00:00Z"),
      },
    ] as any);
    const { handlers } = await makeServer();
    const h = handlers.get("GET /actions")!;
    const rc = createResponseCapture();
    await h({} as any, rc.res);
    expect(rc.status).toBe(200);
    expect(rc.body?.items?.[0]?.id).toBe("a1");
  });

  it("POST /actions returns 400 when capability invalid", async () => {
    const { handlers } = await makeServer();
    const h = handlers.get("POST /actions")!;
    const rc = createResponseCapture();
    await h({ body: { name: "A", capabilityId: "cap", config: {} } } as any, rc.res);
    expect(rc.status).toBe(400);
    expect(rc.body?.code).toBe("INVALID_CAPABILITY");
  });

  it("POST /actions creates definition", async () => {
    db.pluginCapability.findUnique.mockResolvedValueOnce({
      id: "cap1",
      kind: "ACTION",
      isEnabled: true,
    } as any);
    db.actionDefinition.create.mockResolvedValueOnce({
      id: "a1",
      name: "Action",
      capabilityId: "cap1",
      config: {},
      isEnabled: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as any);
    const { handlers } = await makeServer();
    const h = handlers.get("POST /actions")!;
    const rc = createResponseCapture();
    await h({ body: { name: "Action", capabilityId: "cap1", config: {} } } as any, rc.res);
    expect(rc.status).toBe(201);
    expect(rc.body?.id).toBe("a1");
    expect(appendChangeLog).toHaveBeenCalled();
  });

  it("GET /actions/:id returns 404 when missing", async () => {
    db.actionDefinition.findUnique.mockResolvedValueOnce(null as any);
    const { handlers } = await makeServer();
    const h = handlers.get("GET /actions/:id")!;
    const rc = createResponseCapture();
    await h({ params: { id: "missing" } } as any, rc.res);
    expect(rc.status).toBe(404);
  });

  it("PATCH /actions/:id updates fields", async () => {
    db.actionDefinition.update.mockResolvedValueOnce({ id: "a1" } as any);
    const { handlers } = await makeServer();
    const h = handlers.get("PATCH /actions/:id")!;
    const rc = createResponseCapture();
    await h({ params: { id: "a1" }, body: { isEnabled: false } } as any, rc.res);
    expect(rc.status).toBe(204);
    const args = (db.actionDefinition.update as any).mock.calls[0][0].data;
    expect(args).toHaveProperty("isEnabled", false);
    expect(appendChangeLog).toHaveBeenCalled();
  });

  it("DELETE /actions/:id returns 409 when in use", async () => {
    db.actionInvocation.count.mockResolvedValueOnce(1 as any);
    const { handlers } = await makeServer();
    const h = handlers.get("DELETE /actions/:id")!;
    const rc = createResponseCapture();
    await h({ params: { id: "a1" } } as any, rc.res);
    expect(rc.status).toBe(409);
  });

  it("DELETE /actions/:id removes unused action", async () => {
    db.actionDefinition.delete.mockResolvedValueOnce({} as any);
    const { handlers } = await makeServer();
    const h = handlers.get("DELETE /actions/:id")!;
    const rc = createResponseCapture();
    await h({ params: { id: "a1" } } as any, rc.res);
    expect(rc.status).toBe(204);
  });

  it("GET /actions/:id/versions returns changelog entries", async () => {
    db.changeLog.findMany.mockResolvedValueOnce([
      {
        version: 3,
        isSnapshot: false,
        hash: "abc",
        changeNote: null,
        changedPath: null,
        changeKind: "UPDATE_PARENT",
        createdAt: new Date("2024-01-01T00:00:00Z"),
        actorType: "USER",
        actorUserId: "admin",
        actorInvocationId: null,
        actorActionDefinitionId: null,
        onBehalfOfUserId: null,
      },
    ] as any);
    const { handlers } = await makeServer();
    const h = handlers.get("GET /actions/:id/versions")!;
    const rc = createResponseCapture();
    await h({ params: { id: "a1" } } as any, rc.res);
    expect(rc.status).toBe(200);
    expect(rc.body?.items?.[0]?.version).toBe(3);
  });

  it("GET /actions/:id/versions/:version returns materialized state", async () => {
    db.changeLog.findFirst.mockResolvedValueOnce({
      version: 2,
      isSnapshot: false,
      hash: "hash",
      createdAt: new Date("2024-01-01T00:00:00Z"),
      actorType: "USER",
      actorUserId: "admin",
      actorInvocationId: null,
      actorActionDefinitionId: null,
      onBehalfOfUserId: null,
    } as any);
    materializeVersion.mockResolvedValueOnce({
      id: "a1",
      name: "Action",
      config: { foo: "bar" },
      isEnabled: true,
    });
    const { handlers } = await makeServer();
    const h = handlers.get("GET /actions/:id/versions/:version")!;
    const rc = createResponseCapture();
    await h({ params: { id: "a1", version: "2" } } as any, rc.res);
    expect(rc.status).toBe(200);
    expect(rc.body?.state?.config?.foo).toBe("bar");
  });

  it("POST /actions/:id/versions updates config", async () => {
    db.actionDefinition.update.mockResolvedValueOnce({ id: "a1" } as any);
    appendChangeLog.mockResolvedValueOnce({
      version: 5,
      isSnapshot: false,
      hash: "hash",
      changeNote: "note",
      changedPath: null,
      changeKind: "UPDATE_PARENT",
      createdAt: new Date("2024-01-01T00:00:00Z"),
      actorType: "USER",
      actorUserId: "admin",
      actorInvocationId: null,
      actorActionDefinitionId: null,
      onBehalfOfUserId: null,
    } as any);
    const { handlers } = await makeServer();
    const h = handlers.get("POST /actions/:id/versions")!;
    const rc = createResponseCapture();
    await h(
      { params: { id: "a1" }, body: { config: { foo: "bar" }, changeNote: "note" } } as any,
      rc.res,
    );
    expect(rc.status).toBe(201);
    expect(rc.body?.version).toBe(5);
  });

  it("POST /actions/:id/versions/:version/activate restores config", async () => {
    materializeVersion.mockResolvedValueOnce({ config: { foo: "old" } });
    db.actionDefinition.update.mockResolvedValueOnce({ id: "a1" } as any);
    const { handlers } = await makeServer();
    const h = handlers.get("POST /actions/:id/versions/:version/activate")!;
    const rc = createResponseCapture();
    await h({ params: { id: "a1", version: "2" } } as any, rc.res);
    expect(rc.status).toBe(204);
    expect(appendChangeLog).toHaveBeenCalled();
  });

  it("POST /actions/:id/test-run enqueues manual invocation", async () => {
    db.actionDefinition.findUnique.mockResolvedValueOnce({ id: "a1" } as any);
    const queue = {
      enqueueAction: vi.fn(async () => {}),
      consumeActions: vi.fn(async () => {}),
      stop: vi.fn(async () => {}),
    };
    const handlers = new Map<string, HttpHandler>();
    const server = {
      get: (p: string, h: HttpHandler) => handlers.set(`GET ${p}`, h),
      post: (p: string, h: HttpHandler) => handlers.set(`POST ${p}`, h),
      patch: (p: string, h: HttpHandler) => handlers.set(`PATCH ${p}`, h),
      delete: (p: string, h: HttpHandler) => handlers.set(`DELETE ${p}`, h),
    } as any;
    registerActionAdminRoutes(server, {
      queue,
      config: {
        HISTORY_SNAPSHOT_INTERVAL: 20,
        HISTORY_MAX_CHAIN_DEPTH: 200,
        SYSTEM_USER_ID: "sys",
      } as any,
    });
    const h = handlers.get("POST /actions/:id/test-run")!;
    const rc = createResponseCapture();
    await h({ params: { id: "a1" }, body: { context: { foo: "bar" } } } as any, rc.res);
    expect(rc.status).toBe(202);
    expect(queue.enqueueAction).toHaveBeenCalledWith({
      actionDefinitionId: "a1",
      triggerEventId: undefined,
      manualInvokerId: "admin",
      context: { foo: "bar" },
    });
  });
});
