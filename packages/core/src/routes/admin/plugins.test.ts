import { describe, it, expect, vi } from "vitest";
import type { HttpHandler } from "../../http/http-server.js";

const db = {
  plugin: {
    findMany: vi.fn(async () => []),
    findUnique: vi.fn(async () => null),
    delete: vi.fn(async () => ({})),
    deleteMany: vi.fn(async () => ({})),
  },
  pluginCapability: {
    findMany: vi.fn(async () => []),
  },
  triggerDefinition: {
    findMany: vi.fn(async () => []),
  },
  actionDefinition: {
    findMany: vi.fn(async () => []),
  },
  triggerEvent: {
    findFirst: vi.fn(async () => null),
    count: vi.fn(async () => 0),
  },
  apiToken: {
    findUnique: vi.fn(async () => null),
    update: vi.fn(async () => ({})),
  },
  user: {
    findUnique: vi.fn(async () => null),
  },
};

vi.mock("../../db/db.js", () => ({ getDb: () => db }));

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
  recordPluginActionMetric: vi.fn(),
  recordPluginTriggerMetric: vi.fn(),
}));

// Default: requireSession passes
vi.mock("../../middleware/require-session.js", () => ({
  requireSession: vi.fn(async () => ({ user: { id: "u1", role: "ADMIN" } })),
}));

async function makeServer(runtimeOverrides?: Record<string, unknown>) {
  const handlers = new Map<string, HttpHandler>();
  const server = {
    get: (p: string, h: HttpHandler) => handlers.set(`GET ${p}`, h),
    post: (p: string, h: HttpHandler) => handlers.set(`POST ${p}`, h),
    delete: (p: string, h: HttpHandler) => handlers.set(`DELETE ${p}`, h),
  } as any;
  const runtime = {
    getPluginRuntimeSnapshot: vi.fn(() => ({ triggers: [], actions: [] })),
    getRuntimeHealthSummary: vi.fn(() => ({
      generatedAt: new Date(),
      pluginCount: 0,
      triggerDefinitions: {
        total: 0,
        running: 0,
        totalEmitCount: 0,
        errorCount: 0,
        lastActivityAt: undefined,
      },
      actionDefinitions: {
        total: 0,
        successCount: 0,
        retryCount: 0,
        failureCount: 0,
        skippedCount: 0,
        errorCount: 0,
        lastInvocationAt: undefined,
      },
    })),
    getTriggerDefinitionHealth: vi.fn(() => undefined),
    getActionDefinitionHealth: vi.fn(() => undefined),
  } as Record<string, unknown>;
  if (runtimeOverrides) {
    Object.assign(runtime, runtimeOverrides);
  }
  const { registerPluginRoutes } = await import("./plugins.js");
  registerPluginRoutes(server, { runtime: runtime as any });
  return { handlers, runtime };
}

describe("plugin routes", () => {
  it("GET /plugins returns items with capabilities", async () => {
    db.plugin.findMany.mockResolvedValueOnce([
      {
        id: "p1",
        name: "core",
        installedAt: new Date().toISOString(),
        capabilities: [
          { id: "c1", kind: "TRIGGER", key: "cron", displayName: "Cron", isEnabled: true },
        ],
      },
    ] as any);
    const { handlers } = await makeServer();
    const h = handlers.get("GET /plugins")!;
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
    expect(body.items[0].capabilities[0].key).toBe("cron");
  });

  it("GET /plugins accepts bearer token with core:read scope", async () => {
    db.plugin.findMany.mockResolvedValueOnce([
      {
        id: "p1",
        name: "core",
        installedAt: new Date().toISOString(),
        capabilities: [],
      },
    ] as any);
    db.apiToken.findUnique.mockResolvedValueOnce({
      id: "t1",
      scopes: ["core:read"],
      revokedAt: null,
      expiresAt: new Date(Date.now() + 3600_000),
      user: { id: "u1", email: "u1@example.com", isActive: true },
    } as any);
    const { handlers } = await makeServer();
    const h = handlers.get("GET /plugins")!;
    let status = 0;
    let body: any = null;
    await h({ headers: { authorization: "Bearer abc" } } as any, {
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
  });

  it("GET /plugins applies filters, limit, cursor and returns nextCursor", async () => {
    const { handlers } = await makeServer();
    const h = handlers.get("GET /plugins")!;
    db.plugin.findMany.mockClear();
    // Return a full page (limit = 10) so nextCursor is present
    const items = Array.from({ length: 10 }).map((_, i) => ({ id: `p${10 - i}` }));
    items[items.length - 1] = { id: "p1" } as any;
    db.plugin.findMany.mockResolvedValueOnce(items as any);
    let body: any = null;
    await h(
      {
        query: {
          q: "core",
          kind: "TRIGGER",
          capabilityKey: "cron",
          enabled: "true",
          limit: "10",
          cursor: "p3",
        },
      } as any,
      {
        status() {
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
      },
    );
    expect(db.plugin.findMany).toHaveBeenCalled();
    const calls = (db.plugin.findMany as unknown as { mock: { calls: any[][] } }).mock.calls;
    const arg = (calls.at(-1)?.[0] as any) ?? ({} as any);
    expect(arg.take).toBe(10);
    expect(arg.cursor).toEqual({ id: "p3" });
    expect(arg.where?.OR?.length).toBeGreaterThan(0);
    expect(arg.where?.capabilities?.some).toBeTruthy();
    expect(body?.nextCursor).toBe("p1");
  });

  it("POST /plugins/install validates body and returns 202", async () => {
    const { handlers } = await makeServer();
    const h = handlers.get("POST /plugins/install")!;
    let status = 0;
    await h({ body: {} } as any, {
      status(c: number) {
        status = c;
        return this as any;
      },
      json() {},
      header() {
        return this as any;
      },
      redirect() {},
      sendStream() {},
      sendBuffer() {},
    });
    expect(status).toBe(400);

    status = 0;
    await h({ body: { source: "file:./plugins/x" } } as any, {
      status(c: number) {
        status = c;
        return this as any;
      },
      json() {},
      header() {
        return this as any;
      },
      redirect() {},
      sendStream() {},
      sendBuffer() {},
    });
    expect(status).toBe(202);
  });

  it("GET /plugins/:id/status returns runtime snapshot", async () => {
    const installedAt = new Date();
    db.plugin.findUnique.mockResolvedValueOnce({
      id: "plug-1",
      name: "core",
      description: null,
      author: "Latchflow",
      installedAt,
      capabilities: [],
    } as any);
    const updatedAt = new Date();
    db.triggerDefinition.findMany.mockResolvedValueOnce([
      {
        id: "trig-1",
        name: "Cron",
        isEnabled: true,
        createdAt: updatedAt,
        updatedAt,
      },
    ] as any);
    db.actionDefinition.findMany.mockResolvedValueOnce([] as any);

    const triggerHealth = {
      definitionId: "trig-1",
      capabilityId: "cap-1",
      capabilityKey: "cron",
      pluginId: "plug-1",
      pluginName: "core",
      isRunning: true,
      emitCount: 3,
      lastStartAt: new Date(),
      lastStopAt: undefined,
      lastEmitAt: new Date(),
      lastError: undefined,
    };

    const { handlers } = await makeServer({
      getPluginRuntimeSnapshot: vi.fn(() => ({ triggers: [triggerHealth], actions: [] })),
    });

    const h = handlers.get("GET /plugins/:pluginId/status")!;
    let status = 0;
    let body: any;
    await h({ params: { pluginId: "plug-1" } } as any, {
      status(code: number) {
        status = code;
        return this as any;
      },
      json(payload: any) {
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
    expect(body?.plugin?.id).toBe("plug-1");
    expect(body?.runtimeSummary?.runningTriggers).toBe(1);
    expect(body?.definitions?.triggers?.[0]?.runtime?.emitCount).toBe(3);
  });

  it("GET /system/plugin-runtime/health returns summary", async () => {
    const summary = {
      generatedAt: new Date(),
      pluginCount: 2,
      triggerDefinitions: {
        total: 3,
        running: 1,
        totalEmitCount: 5,
        errorCount: 0,
        lastActivityAt: new Date(),
      },
      actionDefinitions: {
        total: 4,
        successCount: 10,
        retryCount: 1,
        failureCount: 2,
        skippedCount: 0,
        errorCount: 1,
        lastInvocationAt: new Date(),
      },
    };
    const { handlers } = await makeServer({ getRuntimeHealthSummary: vi.fn(() => summary) });
    const h = handlers.get("GET /system/plugin-runtime/health")!;
    let status = 0;
    let body: any;
    await h({} as any, {
      status(code: number) {
        status = code;
        return this as any;
      },
      json(payload: any) {
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
    expect(body?.pluginCount).toBe(2);
    expect(body?.triggerDefinitions?.running).toBe(1);
  });

  it("DELETE /plugins/:pluginId deletes and returns 204", async () => {
    const { handlers } = await makeServer();
    const h = handlers.get("DELETE /plugins/:pluginId")!;
    let status = 0;
    await h({ params: { pluginId: "p1" } } as any, {
      status(c: number) {
        status = c;
        return this as any;
      },
      json() {},
      header() {
        return this as any;
      },
      redirect() {},
      sendStream() {},
      sendBuffer() {},
    });
    expect(status).toBe(204);
    expect(db.plugin.delete).toHaveBeenCalled();
  });

  it("GET /capabilities returns items", async () => {
    db.pluginCapability.findMany.mockResolvedValueOnce([
      { id: "c1", kind: "ACTION", key: "email", displayName: "Email", isEnabled: true },
    ] as any);
    const { handlers } = await makeServer();
    const h = handlers.get("GET /capabilities")!;
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
    expect(body?.items?.[0]?.key).toBe("email");
  });

  it("GET /capabilities applies filters, limit, cursor and returns nextCursor", async () => {
    const { handlers } = await makeServer();
    const h = handlers.get("GET /capabilities")!;
    db.pluginCapability.findMany.mockClear();
    // Return a full page (limit = 5) so nextCursor is present
    const caps = Array.from({ length: 5 }).map((_, i) => ({ id: `c${5 - i}` }));
    caps[caps.length - 1] = { id: "c1" } as any;
    db.pluginCapability.findMany.mockResolvedValueOnce(caps as any);
    let body: any = null;
    await h(
      { query: { kind: "ACTION", key: "email", enabled: "true", limit: "5", cursor: "c3" } } as any,
      {
        status() {
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
      },
    );
    expect(db.pluginCapability.findMany).toHaveBeenCalled();
    const calls = (db.pluginCapability.findMany as unknown as { mock: { calls: any[][] } }).mock
      .calls;
    const arg = (calls.at(-1)?.[0] as any) ?? ({} as any);
    expect(arg.take).toBe(5);
    expect(arg.cursor).toEqual({ id: "c3" });
    expect(arg.where?.kind).toBe("ACTION");
    expect(arg.where?.key?.contains).toBe("email");
    expect(arg.where?.isEnabled).toBe(true);
    expect(body?.nextCursor).toBe("c1");
  });
});
