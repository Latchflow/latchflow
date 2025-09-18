import { describe, it, expect, vi, beforeEach } from "vitest";
import { registerPipelineAdminRoutes } from "./pipelines.js";
import type { HttpHandler } from "../../http/http-server.js";
import { createResponseCapture } from "@tests/helpers/response";

const db = {
  pipeline: {
    findMany: vi.fn(async () => []),
    create: vi.fn(async (...args: any[]) => ({
      id: "pl1",
      name: "P",
      description: null,
      isEnabled: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    })),
    findUnique: vi.fn(async () => null),
    update: vi.fn(async (...args: any[]) => ({ id: "pl1" })),
    delete: vi.fn(async (...args: any[]) => ({})),
  },
  pipelineStep: {
    count: vi.fn(async () => 0),
    findMany: vi.fn(async () => []),
    create: vi.fn(async (args: any) => ({
      id: "st1",
      actionId: args.data.actionId,
      sortOrder: args.data.sortOrder,
      isEnabled: args.data.isEnabled ?? true,
    })),
    update: vi.fn(async () => ({})),
    delete: vi.fn(async () => ({})),
  },
  pipelineTrigger: {
    count: vi.fn(async () => 0),
    findMany: vi.fn(async () => []),
    create: vi.fn(async (args: any) => ({
      triggerId: args.data.triggerId,
      sortOrder: args.data.sortOrder,
      isEnabled: args.data.isEnabled ?? true,
    })),
    findUnique: vi.fn(async () => null),
    update: vi.fn(async () => ({})),
    delete: vi.fn(async () => ({})),
  },
  pipelineRun: {
    count: vi.fn(async () => 0),
  },
  actionDefinition: {
    findUnique: vi.fn(async () => ({ id: "act1", isEnabled: true })),
  },
  triggerDefinition: {
    findUnique: vi.fn(async () => ({ id: "trg1", isEnabled: true })),
  },
  changeLog: {
    findMany: vi.fn(async () => []),
    findFirst: vi.fn(async () => null),
  },
  $transaction: vi.fn(async (cb: (tx: typeof db) => Promise<any>) => cb(db)),
};

vi.mock("../../db/db.js", () => ({ getDb: () => db }));

vi.mock("../../middleware/require-session.js", () => ({
  requireSession: vi.fn(async () => ({ user: { id: "u1", role: "ADMIN" } })),
}));

const { appendChangeLogMock, materializeVersionMock } = vi.hoisted(() => {
  return {
    appendChangeLogMock: vi.fn(async () => ({
      version: 1,
      isSnapshot: true,
      hash: "hash",
      changeNote: null,
      changedPath: null,
      changeKind: "UPDATE_PARENT",
      createdAt: new Date("2024-01-01T00:00:00Z"),
      actorType: "USER",
      actorUserId: "u1",
      actorInvocationId: null,
      actorActionDefinitionId: null,
      onBehalfOfUserId: null,
    })),
    materializeVersionMock: vi.fn(async () => ({ id: "pl1" })),
  };
});

vi.mock("../../history/changelog.js", () => ({
  appendChangeLog: appendChangeLogMock,
  materializeVersion: materializeVersionMock,
}));

async function makeServer() {
  const handlers = new Map<string, HttpHandler>();
  const server = {
    get: (p: string, h: HttpHandler) => handlers.set(`GET ${p}`, h),
    post: (p: string, h: HttpHandler) => handlers.set(`POST ${p}`, h),
    patch: (p: string, h: HttpHandler) => handlers.set(`PATCH ${p}`, h),
    delete: (p: string, h: HttpHandler) => handlers.set(`DELETE ${p}`, h),
  } as any;
  registerPipelineAdminRoutes(server, {
    config: {
      HISTORY_SNAPSHOT_INTERVAL: 20,
      HISTORY_MAX_CHAIN_DEPTH: 200,
      SYSTEM_USER_ID: "sys",
    } as any,
  });
  return { handlers };
}

function resetDb() {
  for (const model of Object.values(db) as any[]) {
    if (typeof model === "function") continue;
    for (const fn of Object.values(model) as any[]) {
      if (fn && typeof fn.mockReset === "function") fn.mockReset();
    }
  }
  db.$transaction.mockImplementation(async (cb) => cb(db));
}

describe("pipelines routes", () => {
  beforeEach(() => {
    resetDb();
    appendChangeLogMock.mockClear();
    materializeVersionMock.mockClear();
    const now = new Date("2024-01-01T00:00:00Z");
    db.pipeline.findMany.mockResolvedValue([]);
    db.pipeline.create.mockImplementation(async (args: any) => ({
      id: "pl1",
      name: args?.data?.name ?? "Pipeline",
      description: args?.data?.description ?? null,
      isEnabled: args?.data?.isEnabled ?? true,
      createdAt: now,
      updatedAt: now,
      createdBy: args?.data?.createdBy ?? "u1",
      updatedBy: null,
    }));
    db.pipeline.update.mockResolvedValue({ id: "pl1" } as any);
    db.pipeline.delete.mockResolvedValue({} as any);
    db.pipelineStep.count.mockResolvedValue(0);
    db.pipelineStep.findMany.mockResolvedValue([]);
    db.pipelineStep.create.mockImplementation(async (args: any) => ({
      id: "st1",
      actionId: args.data.actionId,
      sortOrder: args.data.sortOrder ?? 1,
      isEnabled: args.data.isEnabled ?? true,
    }));
    db.pipelineStep.update.mockResolvedValue({} as any);
    db.pipelineStep.delete.mockResolvedValue({} as any);
    db.pipelineTrigger.count.mockResolvedValue(0);
    db.pipelineTrigger.findMany.mockResolvedValue([]);
    db.pipelineTrigger.findUnique.mockResolvedValue(null);
    db.pipelineTrigger.create.mockImplementation(async (args: any) => ({
      triggerId: args.data.triggerId,
      sortOrder: args.data.sortOrder ?? 1,
      isEnabled: args.data.isEnabled ?? true,
    }));
    db.pipelineTrigger.update.mockResolvedValue({} as any);
    db.pipelineTrigger.delete.mockResolvedValue({} as any);
    db.actionDefinition.findUnique.mockResolvedValue({ id: "act1", isEnabled: true } as any);
    db.triggerDefinition.findUnique.mockResolvedValue({ id: "trg1", isEnabled: true } as any);
    db.changeLog.findMany.mockResolvedValue([]);
    db.changeLog.findFirst.mockResolvedValue(null);
  });

  it("GET /pipelines returns items", async () => {
    db.pipeline.findMany.mockResolvedValueOnce([
      {
        id: "pl1",
        name: "Pipeline",
        description: null,
        isEnabled: true,
        createdAt: new Date("2024-01-01T00:00:00Z"),
        updatedAt: new Date("2024-01-01T00:00:00Z"),
      },
    ] as any);
    const { handlers } = await makeServer();
    const h = handlers.get("GET /pipelines")!;
    let status = 0;
    let body: any;
    await h({ query: {} } as any, {
      status(code: number) {
        status = code;
        return this as any;
      },
      json(payload: unknown) {
        body = payload;
      },
      header() {
        return this as any;
      },
      redirect() {},
      sendStream() {},
      sendBuffer() {},
    });
    expect(status).toBe(200);
    expect(body.items[0].id).toBe("pl1");
  });

  it("POST /pipelines creates pipeline", async () => {
    const { handlers } = await makeServer();
    const h = handlers.get("POST /pipelines")!;
    const rc = createResponseCapture();
    await h({ body: { name: "Pipeline" } } as any, rc.res);
    expect(rc.status).toBe(201);
    expect(appendChangeLogMock).toHaveBeenCalled();
  });

  it("GET /pipelines/:id returns detailed pipeline", async () => {
    db.pipeline.findUnique.mockResolvedValueOnce({
      id: "pl1",
      name: "Pipeline",
      description: null,
      isEnabled: true,
      createdAt: new Date("2024-01-01T00:00:00Z"),
      updatedAt: new Date("2024-01-01T00:00:00Z"),
      createdBy: "u1",
      updatedBy: null,
      steps: [{ id: "st1", actionId: "act1", sortOrder: 1, isEnabled: true }],
      triggers: [{ triggerId: "tr1", sortOrder: 1, isEnabled: true }],
    } as any);
    const { handlers } = await makeServer();
    const h = handlers.get("GET /pipelines/:id")!;
    const rc = createResponseCapture();
    await h({ params: { id: "pl1" } } as any, rc.res);
    expect(rc.status).toBe(200);
    expect(rc.body.steps).toHaveLength(1);
  });

  it("PATCH /pipelines/:id updates metadata", async () => {
    db.pipeline.update.mockResolvedValueOnce({ id: "pl1" } as any);
    const { handlers } = await makeServer();
    const h = handlers.get("PATCH /pipelines/:id")!;
    const rc = createResponseCapture();
    await h({ params: { id: "pl1" }, body: { name: "New" } } as any, rc.res);
    expect(rc.status).toBe(204);
    expect(appendChangeLogMock).toHaveBeenCalled();
  });

  it("DELETE /pipelines/:id returns 204 when no usage", async () => {
    db.pipeline.delete.mockResolvedValueOnce({} as any);
    const { handlers } = await makeServer();
    const h = handlers.get("DELETE /pipelines/:id")!;
    const rc = createResponseCapture();
    await h({ params: { id: "pl1" } } as any, rc.res);
    expect(rc.status).toBe(204);
  });

  it("POST /pipelines/:id/steps creates a step", async () => {
    db.pipeline.findUnique.mockResolvedValueOnce({ id: "pl1" } as any);
    db.pipelineStep.findMany.mockResolvedValueOnce([]);
    const { handlers } = await makeServer();
    const h = handlers.get("POST /pipelines/:id/steps")!;
    const rc = createResponseCapture();
    await h({ params: { id: "pl1" }, body: { actionId: "act1" } } as any, rc.res);
    expect(rc.status).toBe(201);
    expect(rc.body.actionId).toBe("act1");
    expect(appendChangeLogMock).toHaveBeenCalled();
  });

  it("POST /pipelines/:id/triggers attaches trigger", async () => {
    db.pipeline.findUnique.mockResolvedValueOnce({ id: "pl1" } as any);
    db.pipelineTrigger.findMany.mockResolvedValueOnce([]);
    const { handlers } = await makeServer();
    const h = handlers.get("POST /pipelines/:id/triggers")!;
    const rc = createResponseCapture();
    await h({ params: { id: "pl1" }, body: { triggerId: "trg1" } } as any, rc.res);
    expect(rc.status).toBe(201);
    expect(rc.body.triggerId).toBe("trg1");
  });

  it("GET /pipelines/:id/versions returns versions", async () => {
    db.changeLog.findMany.mockResolvedValueOnce([
      {
        version: 2,
        isSnapshot: false,
        hash: "hash",
        changeNote: null,
        changedPath: null,
        changeKind: "UPDATE_PARENT",
        createdAt: new Date("2024-01-02T00:00:00Z"),
        actorType: "USER",
        actorUserId: "u1",
        actorInvocationId: null,
        actorActionDefinitionId: null,
        onBehalfOfUserId: null,
      },
    ] as any);
    const { handlers } = await makeServer();
    const h = handlers.get("GET /pipelines/:id/versions")!;
    const rc = createResponseCapture();
    await h({ params: { id: "pl1" } } as any, rc.res);
    expect(rc.status).toBe(200);
    expect(rc.body.items[0].version).toBe(2);
  });

  it("GET /pipelines/:id/versions/:version materializes state", async () => {
    db.changeLog.findFirst.mockResolvedValueOnce({
      version: 1,
      isSnapshot: true,
      hash: "hash",
      createdAt: new Date("2024-01-01T00:00:00Z"),
      actorType: "USER",
      actorUserId: "u1",
      actorInvocationId: null,
      actorActionDefinitionId: null,
      onBehalfOfUserId: null,
    } as any);
    materializeVersionMock.mockResolvedValueOnce({ id: "pl1" });
    const { handlers } = await makeServer();
    const h = handlers.get("GET /pipelines/:id/versions/:version")!;
    const rc = createResponseCapture();
    await h({ params: { id: "pl1", version: "1" } } as any, rc.res);
    expect(rc.status).toBe(200);
    expect(rc.body.version).toBe(1);
  });
});
