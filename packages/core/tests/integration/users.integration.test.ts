import { describe, it, expect, vi, beforeEach } from "vitest";
import type { HttpHandler } from "../../src/http/http-server.js";
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

vi.mock("../../src/db/db.js", () => ({ getDb: () => db }));

vi.mock("../../src/middleware/require-session.js", () => ({
  requireSession: vi.fn(async () => ({ user: { id: "admin_1", role: "ADMIN" } })),
}));

const appendChangeLogMock = vi.fn(async () => ({ id: "cl1", version: 1 }));
vi.mock("../../src/history/changelog.js", () => ({
  appendChangeLog: appendChangeLogMock,
}));

vi.mock("../../src/auth/tokens.js", () => ({
  randomToken: vi.fn(() => "tok123"),
  sha256Hex: vi.fn((input: string) => `hash-${input}`),
}));

function makeServer(configOverrides: Partial<AppConfigLike> = {}) {
  const handlers = new Map<string, HttpHandler>();
  const server = {
    get: (p: string, h: HttpHandler) => handlers.set(`GET ${p}`, h),
    post: (p: string, h: HttpHandler) => handlers.set(`POST ${p}`, h),
    patch: (p: string, h: HttpHandler) => handlers.set(`PATCH ${p}`, h),
    delete: (p: string, h: HttpHandler) => handlers.set(`DELETE ${p}`, h),
  } as any;
  return { handlers, server, configOverrides };
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

describe("users admin routes (integration)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    for (const model of Object.values(db) as any[]) {
      for (const fn of Object.values(model) as any[]) {
        if (typeof fn?.mockReset === "function") fn.mockReset();
      }
    }
    appendChangeLogMock.mockReset();
    appendChangeLogMock.mockResolvedValue({ id: "cl1", version: 1 });
    primeUserMocks();
    db.user.findUnique.mockResolvedValue(null);
    db.session.findMany.mockResolvedValue([]);
    db.session.updateMany.mockResolvedValue({ count: 0 });
    db.magicLink.create.mockResolvedValue({});
  });

  it("create → invite → list filters → get → update → sessions list/revoke", async () => {
    const { handlers, server } = makeServer();
    const emailService = {
      sendEmail: vi.fn(async () => ({ delivered: true })),
    };
    const { registerUserAdminRoutes } = await import("../../src/routes/admin/users.js");
    registerUserAdminRoutes(
      server,
      {
        HISTORY_SNAPSHOT_INTERVAL: 20,
        HISTORY_MAX_CHAIN_DEPTH: 200,
        SYSTEM_USER_ID: "sys",
        ALLOW_DEV_AUTH: true,
        ADMIN_MAGICLINK_TTL_MIN: 15,
      } as any,
      { emailService },
    );

    // Create active user
    const rcCreate = createResponseCapture();
    await handlers.get("POST /users")!(
      { body: { email: "new@example.com", role: "ADMIN" } } as any,
      rcCreate.res,
    );
    expect(rcCreate.status).toBe(201);
    expect(appendChangeLogMock).toHaveBeenCalled();

    // Invite inactive user (dev mode returns loginUrl)
    const rcInvite = createResponseCapture();
    await handlers.get("POST /users/invite")!(
      { body: { email: "invite@example.com", name: "Invited" } } as any,
      rcInvite.res,
    );
    expect(rcInvite.status).toBe(202);
    expect(rcInvite.body.loginUrl).toContain("/auth/admin/callback?token=");
    expect(emailService.sendEmail).not.toHaveBeenCalled();

    // List with filters
    db.user.findMany.mockResolvedValueOnce([
      {
        id: "usr_2",
        email: "exec@example.com",
        name: "Exec",
        displayName: null,
        avatarUrl: null,
        role: "EXECUTOR",
        isActive: true,
        createdAt: new Date("2024-01-01T00:00:00Z"),
        updatedAt: new Date("2024-01-02T00:00:00Z"),
      },
    ] as any);
    const rcList = createResponseCapture();
    await handlers.get("GET /users")!(
      { query: { role: "EXECUTOR", q: "exec", isActive: true } } as any,
      rcList.res,
    );
    expect(rcList.status).toBe(200);
    expect(rcList.body.items[0].email).toBe("exec@example.com");

    // Get single user
    db.user.findUnique.mockResolvedValueOnce({
      id: "usr_2",
      email: "exec@example.com",
      name: "Exec",
      displayName: null,
      avatarUrl: null,
      role: "EXECUTOR",
      isActive: true,
      createdAt: new Date("2024-01-01T00:00:00Z"),
      updatedAt: new Date("2024-01-02T00:00:00Z"),
    } as any);
    const rcGet = createResponseCapture();
    await handlers.get("GET /users/:id")!({ params: { id: "usr_2" } } as any, rcGet.res);
    expect(rcGet.status).toBe(200);
    expect(rcGet.body.role).toBe("EXECUTOR");

    // Update user
    const rcPatch = createResponseCapture();
    await handlers.get("PATCH /users/:id")!(
      { params: { id: "usr_2" }, body: { isActive: false, role: "ADMIN" } } as any,
      rcPatch.res,
    );
    expect(rcPatch.status).toBe(204);
    expect(appendChangeLogMock).toHaveBeenCalledTimes(3);

    // List sessions
    db.user.findUnique.mockResolvedValueOnce({ id: "usr_2" });
    db.session.findMany.mockResolvedValueOnce([
      {
        id: "sess1",
        createdAt: new Date("2024-01-01T00:00:00Z"),
        expiresAt: new Date("2024-01-02T00:00:00Z"),
        ip: "127.0.0.1",
        userAgent: "vitest",
      },
    ] as any);
    const rcSessions = createResponseCapture();
    await handlers.get("GET /users/:id/sessions")!(
      { params: { id: "usr_2" } } as any,
      rcSessions.res,
    );
    expect(rcSessions.status).toBe(200);
    expect(rcSessions.body.items[0].id).toBe("sess1");

    // Revoke sessions
    db.user.findUnique.mockResolvedValueOnce({ id: "usr_2" });
    const rcRevoke = createResponseCapture();
    await handlers.get("POST /users/:id/revoke")!({ params: { id: "usr_2" } } as any, rcRevoke.res);
    expect(rcRevoke.status).toBe(204);
    expect(db.session.updateMany).toHaveBeenCalledWith({
      where: { userId: "usr_2", revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
  }, 10_000);
});
