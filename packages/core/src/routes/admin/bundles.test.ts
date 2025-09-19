import { describe, it, expect, beforeEach, vi } from "vitest";
import { registerBundleAdminRoutes } from "./bundles.js";
import type { HttpHandler } from "../../http/http-server.js";
import { createResponseCapture } from "@tests/helpers/response";

const db = {
  bundle: {
    findMany: vi.fn(async () => []),
    findUnique: vi.fn(async () => null),
    create: vi.fn(async () => ({})),
    update: vi.fn(async () => ({})),
    delete: vi.fn(async () => ({})),
  },
  bundleObject: {
    count: vi.fn(async () => 0),
  },
  bundleAssignment: {
    count: vi.fn(async () => 0),
  },
  downloadEvent: {
    count: vi.fn(async () => 0),
  },
  changeLog: {
    findMany: vi.fn(async () => []),
    findUnique: vi.fn(async () => null),
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
    actorUserId: "admin",
    actorInvocationId: null,
    actorActionDefinitionId: null,
    onBehalfOfUserId: null,
  })),
  materializeVersion: vi.fn(async () => ({ id: "bundle1", name: "Bundle" })),
}));

const appendChangeLog = historyMocks.appendChangeLog;
const materializeVersion = historyMocks.materializeVersion;

vi.mock("../../history/changelog.js", () => historyMocks);

vi.mock("../../middleware/require-session.js", () => ({
  requireSession: vi.fn(async () => ({ user: { id: "admin", role: "ADMIN" } })),
}));

function resetDbMocks() {
  db.bundle.findMany.mockReset();
  db.bundle.findMany.mockResolvedValue([]);
  db.bundle.findUnique.mockReset();
  db.bundle.findUnique.mockResolvedValue(null);
  db.bundle.create.mockReset();
  db.bundle.update.mockReset();
  db.bundle.delete.mockReset();
  db.bundleObject.count.mockReset();
  db.bundleObject.count.mockResolvedValue(0);
  db.bundleAssignment.count.mockReset();
  db.bundleAssignment.count.mockResolvedValue(0);
  db.downloadEvent.count.mockReset();
  db.downloadEvent.count.mockResolvedValue(0);
  db.changeLog.findMany.mockReset();
  db.changeLog.findMany.mockResolvedValue([]);
  db.changeLog.findUnique.mockReset();
  db.changeLog.findUnique.mockResolvedValue(null);
}

async function makeServer(overrides?: { scheduler?: { schedule: ReturnType<typeof vi.fn> } }) {
  const handlers = new Map<string, HttpHandler>();
  const server = {
    get: (p: string, h: HttpHandler) => handlers.set(`GET ${p}`, h),
    post: (p: string, h: HttpHandler) => handlers.set(`POST ${p}`, h),
    patch: (p: string, h: HttpHandler) => handlers.set(`PATCH ${p}`, h),
    delete: (p: string, h: HttpHandler) => handlers.set(`DELETE ${p}`, h),
  } as any;
  const scheduler =
    overrides?.scheduler ??
    ({
      schedule: vi.fn(),
      scheduleForFiles: vi.fn(),
      getStatus: vi.fn(() => ({ state: "idle" })),
    } as any);
  registerBundleAdminRoutes(server, {
    scheduler,
    config: {
      HISTORY_SNAPSHOT_INTERVAL: 20,
      HISTORY_MAX_CHAIN_DEPTH: 200,
      SYSTEM_USER_ID: "sys",
    } as any,
  });
  return { handlers, scheduler };
}

describe("bundle admin routes", () => {
  beforeEach(() => {
    resetDbMocks();
    appendChangeLog.mockClear();
    materializeVersion.mockClear();
  });

  it("GET /bundles returns list", async () => {
    db.bundle.findMany.mockResolvedValueOnce([
      {
        id: "b1",
        name: "Bundle",
        storagePath: "pending",
        checksum: "",
        description: null,
        isEnabled: true,
        createdAt: new Date("2024-01-01T00:00:00Z"),
        updatedAt: new Date("2024-01-02T00:00:00Z"),
      },
    ] as any);
    const { handlers } = await makeServer();
    const h = handlers.get("GET /bundles")!;
    const rc = createResponseCapture();
    await h({ query: {} } as any, rc.res);
    expect(rc.status).toBe(200);
    expect(rc.body).toEqual(
      expect.objectContaining({
        items: [expect.objectContaining({ id: "b1", name: "Bundle" })],
      }),
    );
  });

  it("POST /bundles creates bundle, logs history, and schedules rebuild", async () => {
    const createdAt = new Date("2024-01-01T00:00:00Z");
    db.bundle.create.mockResolvedValueOnce({
      id: "b1",
      name: "Bundle",
      storagePath: "pending://bundle/abc",
      checksum: "",
      description: null,
      isEnabled: true,
      createdAt,
      updatedAt: createdAt,
    } as any);
    const scheduler = { schedule: vi.fn(), scheduleForFiles: vi.fn(), getStatus: vi.fn() } as any;
    const { handlers } = await makeServer({ scheduler });
    const h = handlers.get("POST /bundles")!;
    const rc = createResponseCapture();
    await h({ body: { name: "Bundle" }, user: { id: "admin" } } as any, rc.res);
    expect(rc.status).toBe(201);
    expect(rc.body?.id).toBe("b1");
    expect(db.bundle.create).toHaveBeenCalled();
    expect(appendChangeLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      "BUNDLE",
      "b1",
      expect.anything(),
      expect.objectContaining({ changeKind: "UPDATE_PARENT" }),
    );
    expect(scheduler.schedule).toHaveBeenCalledWith("b1", { force: true });
  });

  it("POST /bundles validates input", async () => {
    const { handlers } = await makeServer();
    const h = handlers.get("POST /bundles")!;
    const rc = createResponseCapture();
    await h({ body: {} } as any, rc.res);
    expect(rc.status).toBe(400);
    expect(rc.body?.code).toBe("BAD_REQUEST");
  });

  it("GET /bundles/:bundleId returns bundle", async () => {
    db.bundle.findUnique.mockResolvedValueOnce({
      id: "b1",
      name: "Bundle",
      storagePath: "s",
      checksum: "c",
      description: null,
      isEnabled: true,
      createdAt: new Date("2024-01-01T00:00:00Z"),
      updatedAt: new Date("2024-01-02T00:00:00Z"),
    } as any);
    const { handlers } = await makeServer();
    const h = handlers.get("GET /bundles/:bundleId")!;
    const rc = createResponseCapture();
    await h({ params: { bundleId: "b1" } } as any, rc.res);
    expect(rc.status).toBe(200);
    expect(rc.body?.id).toBe("b1");
  });

  it("PATCH /bundles/:bundleId updates bundle and logs history", async () => {
    db.bundle.update.mockResolvedValueOnce({ id: "b1" } as any);
    const { handlers } = await makeServer();
    const h = handlers.get("PATCH /bundles/:bundleId")!;
    const rc = createResponseCapture();
    await h(
      { params: { bundleId: "b1" }, body: { name: "Updated" }, user: { id: "admin" } } as any,
      rc.res,
    );
    expect(db.bundle.update).toHaveBeenCalledWith({
      where: { id: "b1" },
      data: expect.objectContaining({ name: "Updated", updatedBy: "admin" }),
    });
    expect(appendChangeLog).toHaveBeenCalled();
    expect(rc.status).toBe(204);
  });

  it("PATCH /bundles/:bundleId handles empty body", async () => {
    const { handlers } = await makeServer();
    const h = handlers.get("PATCH /bundles/:bundleId")!;
    const rc = createResponseCapture();
    await h({ params: { bundleId: "b1" }, body: {} } as any, rc.res);
    expect(rc.status).toBe(400);
  });

  it("DELETE /bundles/:bundleId returns 409 when in use", async () => {
    db.bundleObject.count.mockResolvedValueOnce(1);
    const { handlers } = await makeServer();
    const h = handlers.get("DELETE /bundles/:bundleId")!;
    const rc = createResponseCapture();
    await h({ params: { bundleId: "b1" } } as any, rc.res);
    expect(rc.status).toBe(409);
    expect(rc.body?.code).toBe("IN_USE");
  });

  it("DELETE /bundles/:bundleId removes bundle when unused", async () => {
    db.bundle.delete.mockResolvedValueOnce({} as any);
    const { handlers } = await makeServer();
    const h = handlers.get("DELETE /bundles/:bundleId")!;
    const rc = createResponseCapture();
    await h({ params: { bundleId: "b1" } } as any, rc.res);
    expect(db.bundle.delete).toHaveBeenCalledWith({ where: { id: "b1" } });
    expect(rc.status).toBe(204);
  });

  it("GET /bundles/:bundleId/versions returns history entries", async () => {
    db.changeLog.findMany.mockResolvedValueOnce([
      {
        version: 3,
        isSnapshot: false,
        hash: "hash",
        changeNote: null,
        changedPath: null,
        changeKind: "UPDATE_PARENT",
        createdAt: new Date("2024-01-03T00:00:00Z"),
        actorType: "USER",
        actorUserId: "admin",
        actorInvocationId: null,
        actorActionDefinitionId: null,
        onBehalfOfUserId: null,
      },
    ] as any);
    const { handlers } = await makeServer();
    const h = handlers.get("GET /bundles/:bundleId/versions")!;
    const rc = createResponseCapture();
    await h({ params: { bundleId: "b1" } } as any, rc.res);
    expect(rc.status).toBe(200);
    expect(rc.body?.items?.[0]?.version).toBe(3);
  });

  it("GET /bundles/:bundleId/versions/:version returns materialized state", async () => {
    db.changeLog.findUnique.mockResolvedValueOnce({
      version: 2,
      isSnapshot: true,
      hash: "hash",
      createdAt: new Date("2024-01-02T00:00:00Z"),
      actorType: "USER",
      actorUserId: "admin",
      actorInvocationId: null,
      actorActionDefinitionId: null,
      onBehalfOfUserId: null,
    } as any);
    materializeVersion.mockResolvedValueOnce({ id: "b1", name: "Bundle" });
    const { handlers } = await makeServer();
    const h = handlers.get("GET /bundles/:bundleId/versions/:version")!;
    const rc = createResponseCapture();
    await h({ params: { bundleId: "b1", version: "2" } } as any, rc.res);
    expect(rc.status).toBe(200);
    expect(rc.body?.state).toEqual(expect.objectContaining({ id: "b1" }));
  });
});
