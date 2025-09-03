import { describe, it, expect, vi } from "vitest";
import type { HttpHandler } from "../../http/http-server.js";

const db = {
  plugin: {
    findMany: vi.fn(async () => []),
    delete: vi.fn(async () => ({})),
    deleteMany: vi.fn(async () => ({})),
  },
  pluginCapability: {
    findMany: vi.fn(async () => []),
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

// Default: requireSession passes
vi.mock("../../middleware/require-session.js", () => ({
  requireSession: vi.fn(async () => ({ user: { id: "u1", role: "ADMIN" } })),
}));

async function makeServer() {
  const handlers = new Map<string, HttpHandler>();
  const server = {
    get: (p: string, h: HttpHandler) => handlers.set(`GET ${p}`, h),
    post: (p: string, h: HttpHandler) => handlers.set(`POST ${p}`, h),
    delete: (p: string, h: HttpHandler) => handlers.set(`DELETE ${p}`, h),
  } as any;
  const { registerPluginRoutes } = await import("./plugins.js");
  registerPluginRoutes(server);
  return { handlers };
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
