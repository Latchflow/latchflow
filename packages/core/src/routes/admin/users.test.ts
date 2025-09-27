import { describe, it, expect, vi, beforeEach } from "vitest";
import { registerUserAdminRoutes } from "./users.js";
import type { HttpHandler } from "../../http/http-server.js";
import { createResponseCapture } from "@tests/helpers/response";

const db = {
  user: {
    findMany: vi.fn(async () => []),
    create: vi.fn(async () => null),
    findUnique: vi.fn(async () => null),
    update: vi.fn(async () => null),
  },
  session: {
    findMany: vi.fn(async () => []),
    updateMany: vi.fn(async () => ({ count: 0 })),
  },
  magicLink: {
    create: vi.fn(async () => ({})),
  },
  changeLog: {
    findMany: vi.fn(async () => []),
  },
};

function primeUserMocks() {
  db.user.create.mockImplementation(async (args: any) => ({
    id: "usr_1",
    email: args.data.email,
    name: args.data.name ?? null,
    displayName: args.data.displayName ?? null,
    avatarUrl: null,
    role: args.data.role ?? "EXECUTOR",
    isActive: args.data.isActive ?? true,
    createdAt: new Date("2024-01-01T00:00:00Z"),
    updatedAt: new Date("2024-01-01T00:00:00Z"),
  }));
  db.user.update.mockImplementation(async (args: any) => ({
    id: args.where.id,
    email: "user@example.com",
    name: args.data.name ?? null,
    displayName: args.data.displayName ?? null,
    avatarUrl: null,
    role: args.data.role ?? "EXECUTOR",
    isActive: args.data.isActive ?? true,
    createdAt: new Date("2024-01-01T00:00:00Z"),
    updatedAt: new Date("2024-01-02T00:00:00Z"),
  }));
  db.user.findMany.mockResolvedValue([]);
}

primeUserMocks();

vi.mock("../../db/db.js", () => ({ getDb: () => db }));

vi.mock("../../middleware/require-session.js", () => ({
  requireSession: vi.fn(async () => ({ user: { id: "admin_1", role: "ADMIN" } })),
}));

const { appendChangeLogMock } = vi.hoisted(() => ({
  appendChangeLogMock: vi.fn(async () => ({
    version: 1,
    isSnapshot: true,
    hash: "hash",
    changeNote: null,
    changedPath: null,
    changeKind: "UPDATE_PARENT",
    createdAt: new Date("2024-01-01T00:00:00Z"),
    actorType: "USER",
    actorUserId: "admin_1",
    actorInvocationId: null,
    actorActionDefinitionId: null,
    onBehalfOfUserId: null,
  })),
}));

vi.mock("../../history/changelog.js", () => ({
  appendChangeLog: appendChangeLogMock,
}));

vi.mock("../../auth/tokens.js", () => ({
  randomToken: () => "tok123",
  sha256Hex: (input: string) => `hash-${input}`,
}));

const { systemConfigGetMock, getSystemConfigServiceMock } = vi.hoisted(() => {
  const systemConfigGetMock = vi.fn();
  const service = { get: systemConfigGetMock };
  return {
    systemConfigGetMock,
    getSystemConfigServiceMock: vi.fn(async () => service),
  };
});

vi.mock("../../config/system-config-startup.js", () => ({
  getSystemConfigService: getSystemConfigServiceMock,
}));

vi.mock("nodemailer", () => {
  const createTransport = vi.fn(() => ({ sendMail: vi.fn(async () => ({})) }));
  return {
    default: { createTransport },
    createTransport,
  };
});

async function makeServer(overrides?: Partial<AppConfigLike>) {
  const handlers = new Map<string, HttpHandler>();
  const server = {
    get: (p: string, h: HttpHandler) => handlers.set(`GET ${p}`, h),
    post: (p: string, h: HttpHandler) => handlers.set(`POST ${p}`, h),
    patch: (p: string, h: HttpHandler) => handlers.set(`PATCH ${p}`, h),
    delete: (p: string, h: HttpHandler) => handlers.set(`DELETE ${p}`, h),
  } as any;
  registerUserAdminRoutes(server, {
    HISTORY_SNAPSHOT_INTERVAL: 20,
    HISTORY_MAX_CHAIN_DEPTH: 200,
    SYSTEM_USER_ID: "sys",
    ALLOW_DEV_AUTH: true,
    ADMIN_MAGICLINK_TTL_MIN: 15,
    ...overrides,
  });
  return { handlers };
}

type AppConfigLike = {
  HISTORY_SNAPSHOT_INTERVAL: number;
  HISTORY_MAX_CHAIN_DEPTH: number;
  SYSTEM_USER_ID: string;
  ALLOW_DEV_AUTH: boolean;
  ADMIN_MAGICLINK_TTL_MIN: number;
  SMTP_URL?: string | null;
  SMTP_FROM?: string | null;
};

function resetMocks() {
  for (const model of Object.values(db) as any[]) {
    for (const fn of Object.values(model) as any[]) {
      if (typeof fn?.mockReset === "function") fn.mockReset();
      if (typeof fn?.mockClear === "function") fn.mockClear();
    }
  }
  appendChangeLogMock.mockReset();
  appendChangeLogMock.mockResolvedValue({
    version: 1,
    isSnapshot: true,
    hash: "hash",
    changeNote: null,
    changedPath: null,
    changeKind: "UPDATE_PARENT",
    createdAt: new Date("2024-01-01T00:00:00Z"),
    actorType: "USER",
    actorUserId: "admin_1",
    actorInvocationId: null,
    actorActionDefinitionId: null,
    onBehalfOfUserId: null,
  });
  primeUserMocks();
  systemConfigGetMock.mockReset();
  systemConfigGetMock.mockResolvedValue(null);
  getSystemConfigServiceMock.mockReset();
  getSystemConfigServiceMock.mockResolvedValue({ get: systemConfigGetMock });
}

describe("users routes", () => {
  beforeEach(() => {
    resetMocks();
    db.user.findMany.mockResolvedValue([]);
    db.user.findUnique.mockResolvedValue(null);
    db.session.findMany.mockResolvedValue([]);
    db.session.updateMany.mockResolvedValue({ count: 0 });
    db.magicLink.create.mockResolvedValue({});
  });

  it("GET /users returns list", async () => {
    db.user.findMany.mockResolvedValueOnce([
      {
        id: "usr_1",
        email: "one@example.com",
        name: null,
        displayName: null,
        avatarUrl: null,
        role: "EXECUTOR",
        isActive: true,
        createdAt: new Date("2024-01-01T00:00:00Z"),
        updatedAt: new Date("2024-01-02T00:00:00Z"),
      },
    ] as any);
    const { handlers } = await makeServer();
    const h = handlers.get("GET /users")!;
    const rc = createResponseCapture();
    await h({ query: {} } as any, rc.res);
    expect(rc.status).toBe(200);
    expect(rc.body.items).toHaveLength(1);
    expect(rc.body.items[0].email).toBe("one@example.com");
  });

  it("POST /users creates active user", async () => {
    const { handlers } = await makeServer();
    const h = handlers.get("POST /users")!;
    const rc = createResponseCapture();
    await h({ body: { email: "new@example.com", role: "ADMIN" } } as any, rc.res);
    expect(rc.status).toBe(201);
    expect(rc.body.role).toBe("ADMIN");
    expect(appendChangeLogMock).toHaveBeenCalled();
  });

  it("POST /users handles email conflict", async () => {
    db.user.create.mockRejectedValueOnce({ code: "P2002" });
    const { handlers } = await makeServer();
    const h = handlers.get("POST /users")!;
    const rc = createResponseCapture();
    await h({ body: { email: "dup@example.com" } } as any, rc.res);
    expect(rc.status).toBe(409);
    expect(rc.body.code).toBe("EMAIL_EXISTS");
  });

  it("POST /users/invite creates inactive user and returns login url when dev auth", async () => {
    db.user.findUnique.mockResolvedValueOnce(null);
    const { handlers } = await makeServer();
    const h = handlers.get("POST /users/invite")!;
    const rc = createResponseCapture();
    await h({ body: { email: "invite@example.com" } } as any, rc.res);
    expect(rc.status).toBe(202);
    expect(rc.body.loginUrl).toContain("/auth/admin/callback?token=");
    expect(db.magicLink.create).toHaveBeenCalled();
  });

  it("POST /users/invite sends SMTP email when configured in system config", async () => {
    const now = new Date("2024-01-01T00:00:00Z");
    systemConfigGetMock.mockImplementation(async (key: string) => {
      if (key === "SMTP_URL") {
        return {
          key,
          value: "smtp://localhost:1025",
          category: "email",
          schema: null,
          metadata: null,
          isSecret: true,
          isActive: true,
          createdAt: now,
          updatedAt: now,
          createdBy: null,
          updatedBy: null,
          source: "database",
        };
      }
      if (key === "SMTP_FROM") {
        return {
          key,
          value: "mailer@example.com",
          category: "email",
          schema: null,
          metadata: null,
          isSecret: false,
          isActive: true,
          createdAt: now,
          updatedAt: now,
          createdBy: null,
          updatedBy: null,
          source: "database",
        };
      }
      return null;
    });

    const mailer = await vi.importMock<typeof import("nodemailer")>("nodemailer");
    const sendMail = vi.fn(async () => ({}));
    (mailer.createTransport as any).mockReturnValueOnce({ sendMail });

    const { handlers } = await makeServer({ ALLOW_DEV_AUTH: false });
    const h = handlers.get("POST /users/invite")!;
    const rc = createResponseCapture();
    await h({ body: { email: "invitee@example.com" } } as any, rc.res);

    expect(rc.status).toBe(202);
    expect(rc.body).toBeUndefined();
    expect(sendMail).toHaveBeenCalled();
    expect(systemConfigGetMock).toHaveBeenCalledWith("SMTP_URL");
    expect(systemConfigGetMock).toHaveBeenCalledWith("SMTP_FROM");
  });

  it("GET /users/:id returns user", async () => {
    db.user.findUnique.mockResolvedValueOnce({
      id: "usr_1",
      email: "one@example.com",
      name: null,
      displayName: null,
      avatarUrl: null,
      role: "EXECUTOR",
      isActive: true,
      createdAt: new Date("2024-01-01T00:00:00Z"),
      updatedAt: new Date("2024-01-02T00:00:00Z"),
    } as any);
    const { handlers } = await makeServer();
    const h = handlers.get("GET /users/:id")!;
    const rc = createResponseCapture();
    await h({ params: { id: "usr_1" } } as any, rc.res);
    expect(rc.status).toBe(200);
    expect(rc.body.email).toBe("one@example.com");
  });

  it("PATCH /users/:id updates fields", async () => {
    db.user.update.mockResolvedValueOnce({ id: "usr_1" } as any);
    const { handlers } = await makeServer();
    const h = handlers.get("PATCH /users/:id")!;
    const rc = createResponseCapture();
    await h({ params: { id: "usr_1" }, body: { isActive: false } } as any, rc.res);
    expect(rc.status).toBe(204);
    expect(appendChangeLogMock).toHaveBeenCalled();
  });

  it("GET /users/:id/sessions lists active sessions", async () => {
    db.user.findUnique.mockResolvedValueOnce({ id: "usr_1" });
    db.session.findMany.mockResolvedValueOnce([
      {
        id: "sess1",
        createdAt: new Date("2024-01-01T00:00:00Z"),
        expiresAt: new Date("2024-01-02T00:00:00Z"),
        ip: "127.0.0.1",
        userAgent: "Vitest",
      },
    ] as any);
    const { handlers } = await makeServer();
    const h = handlers.get("GET /users/:id/sessions")!;
    const rc = createResponseCapture();
    await h({ params: { id: "usr_1" } } as any, rc.res);
    expect(rc.status).toBe(200);
    expect(rc.body.items[0].id).toBe("sess1");
  });

  it("POST /users/:id/revoke revokes sessions", async () => {
    db.user.findUnique.mockResolvedValueOnce({ id: "usr_1" });
    const { handlers } = await makeServer();
    const h = handlers.get("POST /users/:id/revoke")!;
    const rc = createResponseCapture();
    await h({ params: { id: "usr_1" } } as any, rc.res);
    expect(rc.status).toBe(204);
    expect(db.session.updateMany).toHaveBeenCalled();
  });
});
