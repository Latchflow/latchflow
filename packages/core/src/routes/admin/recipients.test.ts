import { describe, it, expect, beforeEach, vi } from "vitest";
import type { HttpHandler } from "../../http/http-server.js";
import { registerRecipientAdminRoutes } from "./recipients.js";
import { createResponseCapture } from "@tests/helpers/response";

const db = {
  recipient: {
    findMany: vi.fn(async () => []),
    findUnique: vi.fn(async () => null),
    create: vi.fn(async () => ({})),
    update: vi.fn(async () => ({})),
    delete: vi.fn(async () => ({})),
  },
  bundleAssignment: {
    count: vi.fn(async () => 0),
    findMany: vi.fn(async () => []),
    findUnique: vi.fn(async () => null),
    create: vi.fn(async () => ({})),
    createMany: vi.fn(async () => ({})),
    delete: vi.fn(async () => ({})),
  },
  changeLog: {
    findMany: vi.fn(async () => []),
    findUnique: vi.fn(async () => null),
  },
  downloadEvent: {
    count: vi.fn(async () => 0),
  },
};

vi.mock("../../db/db.js", () => ({ getDb: () => db }));

const historyMocks = vi.hoisted(() => ({
  appendChangeLog: vi.fn(async () => ({
    version: 1,
    isSnapshot: true,
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
  materializeVersion: vi.fn(async () => ({ id: "r1", email: "user@example.com" })),
}));

const appendChangeLog = historyMocks.appendChangeLog;
const materializeVersion = historyMocks.materializeVersion;

vi.mock("../../history/changelog.js", () => historyMocks);

vi.mock("../../middleware/require-session.js", () => ({
  requireSession: vi.fn(async () => ({ user: { id: "admin", role: "ADMIN" } })),
}));

function resetDbMocks() {
  db.recipient.findMany.mockReset();
  db.recipient.findMany.mockResolvedValue([]);
  db.recipient.findUnique.mockReset();
  db.recipient.findUnique.mockResolvedValue(null);
  db.recipient.create.mockReset();
  db.recipient.update.mockReset();
  db.recipient.delete.mockReset();
  db.bundleAssignment.count.mockReset();
  db.bundleAssignment.count.mockResolvedValue(0);
  db.bundleAssignment.findMany.mockReset();
  db.bundleAssignment.findMany.mockResolvedValue([]);
  db.bundleAssignment.findUnique.mockReset();
  db.bundleAssignment.findUnique.mockResolvedValue(null);
  db.bundleAssignment.create.mockReset();
  db.bundleAssignment.createMany.mockReset();
  db.bundleAssignment.delete.mockReset();
  db.downloadEvent.count.mockReset();
  db.downloadEvent.count.mockResolvedValue(0);
  db.changeLog.findMany.mockReset();
  db.changeLog.findMany.mockResolvedValue([]);
  db.changeLog.findUnique.mockReset();
  db.changeLog.findUnique.mockResolvedValue(null);
}

async function makeServer(overrides?: {
  config?: {
    HISTORY_SNAPSHOT_INTERVAL: number;
    HISTORY_MAX_CHAIN_DEPTH: number;
    SYSTEM_USER_ID?: string;
  };
}) {
  const handlers = new Map<string, HttpHandler>();
  const server = {
    get: (p: string, h: HttpHandler) => handlers.set(`GET ${p}`, h),
    post: (p: string, h: HttpHandler) => handlers.set(`POST ${p}`, h),
    patch: (p: string, h: HttpHandler) => handlers.set(`PATCH ${p}`, h),
    delete: (p: string, h: HttpHandler) => handlers.set(`DELETE ${p}`, h),
  } as any;
  registerRecipientAdminRoutes(server, {
    HISTORY_SNAPSHOT_INTERVAL: 20,
    HISTORY_MAX_CHAIN_DEPTH: 200,
    SYSTEM_USER_ID: "sys",
    ...(overrides?.config ?? {}),
  } as any);
  return { handlers };
}

describe("recipient admin routes", () => {
  beforeEach(() => {
    resetDbMocks();
    appendChangeLog.mockClear();
    materializeVersion.mockClear();
  });

  it("GET /recipients returns list", async () => {
    db.recipient.findMany.mockResolvedValueOnce([
      {
        id: "r1",
        email: "user@example.com",
        name: "User",
        isEnabled: true,
        createdAt: new Date("2024-01-01T00:00:00Z"),
        updatedAt: new Date("2024-01-02T00:00:00Z"),
      },
    ] as any);
    const { handlers } = await makeServer();
    const h = handlers.get("GET /recipients")!;
    const rc = createResponseCapture();
    await h({ query: {} } as any, rc.res);
    expect(rc.status).toBe(200);
    expect(rc.body?.items?.[0]?.email).toBe("user@example.com");
  });

  it("POST /recipients creates recipient and logs history", async () => {
    db.recipient.create.mockResolvedValueOnce({
      id: "r1",
      email: "user@example.com",
      name: "User",
      isEnabled: true,
      createdAt: new Date("2024-01-01T00:00:00Z"),
      updatedAt: new Date("2024-01-01T00:00:00Z"),
    } as any);
    const { handlers } = await makeServer();
    const h = handlers.get("POST /recipients")!;
    const rc = createResponseCapture();
    await h({ body: { email: "user@example.com" }, user: { id: "admin" } } as any, rc.res);
    expect(rc.status).toBe(201);
    expect(db.recipient.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ email: "user@example.com", createdBy: "admin" }),
      }),
    );
    expect(appendChangeLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      "RECIPIENT",
      "r1",
      expect.anything(),
      expect.objectContaining({ changeKind: "UPDATE_PARENT" }),
    );
  });

  it("POST /recipients handles duplicate email", async () => {
    const error = Object.assign(new Error("duplicate"), { code: "P2002" });
    db.recipient.create.mockRejectedValueOnce(error);
    const { handlers } = await makeServer();
    const h = handlers.get("POST /recipients")!;
    const rc = createResponseCapture();
    await h({ body: { email: "user@example.com" } } as any, rc.res);
    expect(rc.status).toBe(409);
    expect(rc.body?.code).toBe("EMAIL_EXISTS");
  });

  it("GET /recipients/:id returns recipient", async () => {
    db.recipient.findUnique.mockResolvedValueOnce({
      id: "r1",
      email: "user@example.com",
      name: "User",
      isEnabled: true,
      createdAt: new Date("2024-01-01T00:00:00Z"),
      updatedAt: new Date("2024-01-02T00:00:00Z"),
    } as any);
    const { handlers } = await makeServer();
    const h = handlers.get("GET /recipients/:recipientId")!;
    const rc = createResponseCapture();
    await h({ params: { recipientId: "r1" } } as any, rc.res);
    expect(rc.status).toBe(200);
    expect(rc.body?.id).toBe("r1");
  });

  it("PATCH /recipients/:id updates recipient and logs history", async () => {
    db.recipient.update.mockResolvedValueOnce({ id: "r1" } as any);
    const { handlers } = await makeServer();
    const h = handlers.get("PATCH /recipients/:recipientId")!;
    const rc = createResponseCapture();
    await h(
      { params: { recipientId: "r1" }, body: { name: "New" }, user: { id: "admin" } } as any,
      rc.res,
    );
    expect(db.recipient.update).toHaveBeenCalledWith({
      where: { id: "r1" },
      data: expect.objectContaining({ name: "New", updatedBy: "admin" }),
    });
    expect(appendChangeLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      "RECIPIENT",
      "r1",
      expect.anything(),
      expect.anything(),
    );
    expect(rc.status).toBe(204);
  });

  it("DELETE /recipients/:id blocks when assignments exist", async () => {
    db.bundleAssignment.count.mockResolvedValueOnce(1);
    const { handlers } = await makeServer();
    const h = handlers.get("DELETE /recipients/:recipientId")!;
    const rc = createResponseCapture();
    await h({ params: { recipientId: "r1" } } as any, rc.res);
    expect(rc.status).toBe(409);
    expect(rc.body?.code).toBe("IN_USE");
  });

  it("GET /recipients/:id/versions returns history entries", async () => {
    db.changeLog.findMany.mockResolvedValueOnce([
      {
        version: 1,
        isSnapshot: true,
        hash: "hash",
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
    const h = handlers.get("GET /recipients/:recipientId/versions")!;
    const rc = createResponseCapture();
    await h({ params: { recipientId: "r1" } } as any, rc.res);
    expect(rc.status).toBe(200);
    expect(rc.body?.items?.[0]?.version).toBe(1);
  });

  it("GET /recipients/:id/versions/:version returns materialized state", async () => {
    db.changeLog.findUnique.mockResolvedValueOnce({
      version: 1,
      isSnapshot: true,
      hash: "hash",
      createdAt: new Date("2024-01-01T00:00:00Z"),
      actorType: "USER",
      actorUserId: "admin",
      actorInvocationId: null,
      actorActionDefinitionId: null,
      onBehalfOfUserId: null,
    } as any);
    materializeVersion.mockResolvedValueOnce({ id: "r1", email: "user@example.com" });
    const { handlers } = await makeServer();
    const h = handlers.get("GET /recipients/:recipientId/versions/:version")!;
    const rc = createResponseCapture();
    await h({ params: { recipientId: "r1", version: "1" } } as any, rc.res);
    expect(rc.status).toBe(200);
    expect(rc.body?.state).toEqual(expect.objectContaining({ id: "r1" }));
  });

  it("GET /bundles/:bundleId/recipients returns recipients", async () => {
    db.bundleAssignment.findMany.mockResolvedValueOnce([
      {
        recipient: {
          id: "r1",
          email: "user@example.com",
          name: "User",
          isEnabled: true,
          createdAt: new Date("2024-01-01T00:00:00Z"),
          updatedAt: new Date("2024-01-01T00:00:00Z"),
        },
        createdAt: new Date("2024-01-01T00:00:00Z"),
        updatedAt: new Date("2024-01-02T00:00:00Z"),
      },
    ] as any);
    const { handlers } = await makeServer();
    const h = handlers.get("GET /bundles/:bundleId/recipients")!;
    const rc = createResponseCapture();
    await h({ params: { bundleId: "b1" } } as any, rc.res);
    expect(rc.status).toBe(200);
    expect(rc.body?.items?.[0]?.email).toBe("user@example.com");
  });

  it("POST /bundles/:bundleId/recipients attaches recipient", async () => {
    const recipientId = "11111111-1111-1111-1111-111111111111";
    db.recipient.findUnique.mockResolvedValue({ id: recipientId } as any);
    db.bundleAssignment.findUnique.mockResolvedValue(null as any);
    const { handlers } = await makeServer();
    const h = handlers.get("POST /bundles/:bundleId/recipients")!;
    const rc = createResponseCapture();
    await h(
      {
        params: { bundleId: "b1" },
        body: { recipientId },
        user: { id: "admin" },
      } as any,
      rc.res,
    );
    expect(rc.status).toBe(204);
    expect(db.bundleAssignment.create).toHaveBeenCalledWith({
      data: { bundleId: "b1", recipientId, createdBy: "admin" },
    });
    expect(appendChangeLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      "BUNDLE",
      "b1",
      expect.anything(),
      expect.objectContaining({ changeKind: "UPDATE_CHILD" }),
    );
    expect(rc.status).toBe(204);
  });

  it("DELETE /bundles/:bundleId/recipients detaches recipient when no downloads", async () => {
    db.bundleAssignment.findUnique.mockResolvedValueOnce({ id: "assign1" } as any);
    const { handlers } = await makeServer();
    const h = handlers.get("DELETE /bundles/:bundleId/recipients")!;
    const rc = createResponseCapture();
    await h(
      { params: { bundleId: "b1" }, query: { recipientId: "r1" }, user: { id: "admin" } } as any,
      rc.res,
    );
    expect(db.bundleAssignment.delete).toHaveBeenCalledWith({
      where: { bundleId_recipientId: { bundleId: "b1", recipientId: "r1" } },
    });
    expect(appendChangeLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      "BUNDLE",
      "b1",
      expect.anything(),
      expect.objectContaining({ changeKind: "REMOVE_CHILD" }),
    );
    expect(rc.status).toBe(204);
  });
});
