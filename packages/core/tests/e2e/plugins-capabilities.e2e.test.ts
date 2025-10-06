import { describe, it, expect, beforeAll, vi } from "vitest";
import type { HttpHandler, HttpServer } from "../../src/http/http-server.js";
import { getEnv } from "@tests/helpers/containers";
import { createResponseCapture } from "@tests/helpers/response";

// Bypass auth like in presigned upload E2E; attach a synthetic admin user id
let ADMIN_ID = "e2e-admin";
vi.mock("../../src/middleware/require-admin-or-api-token.js", () => ({
  requireAdminOrApiToken: (_opts: any) => (h: HttpHandler) => async (req: any, res: any) => {
    req.user = { id: ADMIN_ID };
    return h(req, res);
  },
}));

function makeServer() {
  const handlers = new Map<string, HttpHandler>();
  const server: HttpServer = {
    get: (p, h) => {
      handlers.set(`GET ${p}`, h);
      return undefined as any;
    },
    post: (p, h) => {
      handlers.set(`POST ${p}`, h);
      return undefined as any;
    },
    put: (p, h) => {
      handlers.set(`PUT ${p}`, h);
      return undefined as any;
    },
    delete: (p, h) => {
      handlers.set(`DELETE ${p}`, h);
      return undefined as any;
    },
    use: () => undefined as any,
    listen: async () => undefined as any,
  } as unknown as HttpServer;
  return { handlers, server };
}

async function seedPlugins(suffix: string) {
  const { prisma } = await import("@latchflow/db");
  // Create two plugins with mixed capabilities
  const p1 = await prisma.plugin.create({
    data: { name: `e2e_plugin_alpha_${suffix}`, author: "E2E" },
  });
  const p2 = await prisma.plugin.create({
    data: { name: `e2e_plugin_beta_${suffix}`, author: "E2E" },
  });
  const c1 = await prisma.pluginCapability.create({
    data: {
      pluginId: p1.id,
      kind: "TRIGGER",
      key: "cron",
      displayName: "Scheduled Trigger",
      jsonSchema: { type: "object" },
      isEnabled: true,
    },
  });
  const c2 = await prisma.pluginCapability.create({
    data: {
      pluginId: p1.id,
      kind: "ACTION",
      key: "email",
      displayName: "Email Notify",
      jsonSchema: { type: "object" },
      isEnabled: true,
    },
  });
  const c3 = await prisma.pluginCapability.create({
    data: {
      pluginId: p2.id,
      kind: "TRIGGER",
      key: "webhook",
      displayName: "Webhook Trigger",
      jsonSchema: { type: "object" },
      isEnabled: false,
    },
  });
  return { p1, p2, c1, c2, c3 };
}

describe("E2E: Plugins & Capabilities endpoints", () => {
  beforeAll(() => {
    // Ensure containers env is initialized (DATABASE_URL set in e2e setup)
    expect(getEnv().postgres.url).toBeTruthy();
  });
  it("GET /plugins returns items and supports filters", async () => {
    const { handlers, server } = makeServer();
    const { registerPluginRoutes } = await import("../../src/routes/admin/plugins.js");
    registerPluginRoutes(server);

    const { prisma } = await import("@latchflow/db");
    const admin = await prisma.user.upsert({
      where: { email: "e2e.plugins@example.com" },
      update: {},
      create: { email: "e2e.plugins@example.com", role: "ADMIN" as any },
    });
    ADMIN_ID = admin.id;
    const S = Math.random().toString(36).slice(2, 8);
    const { p1 } = await seedPlugins(S);

    // Basic list
    const hList = handlers.get("GET /plugins")!;
    const rc1 = createResponseCapture();
    await hList({ headers: {} } as any, rc1.res);
    expect(rc1.status).toBe(200);
    expect(Array.isArray(rc1.body?.items)).toBe(true);
    expect(rc1.body.items.length).toBeGreaterThanOrEqual(2);
    const foundAlpha = rc1.body.items.find((p: any) => p.id === p1.id || p.name === p1.name);
    expect(foundAlpha?.capabilities?.length).toBe(2);

    // Filter by capabilityKey substring
    const rc2 = createResponseCapture();
    await hList({ headers: {}, query: { capabilityKey: "cron" } } as any, rc2.res);
    expect(rc2.status).toBe(200);
    expect(
      rc2.body.items.every((p: any) => p.capabilities.some((c: any) => c.key.includes("cron"))),
    ).toBe(true);

    // Filter by kind=TRIGGER
    const rc3 = createResponseCapture();
    await hList({ headers: {}, query: { kind: "TRIGGER" } } as any, rc3.res);
    expect(rc3.status).toBe(200);
    expect(rc3.body.items.length).toBeGreaterThanOrEqual(1);

    // Free-text q against name
    const rc4 = createResponseCapture();
    await hList({ headers: {}, query: { q: p1.name } } as any, rc4.res);
    expect(rc4.status).toBe(200);
    expect(rc4.body.items.length).toBe(1);
    expect(rc4.body.items[0].id).toBe(p1.id);
  });

  it("GET /capabilities returns items and supports filters", async () => {
    const { handlers, server } = makeServer();
    const { registerPluginRoutes } = await import("../../src/routes/admin/plugins.js");
    registerPluginRoutes(server);

    const { prisma } = await import("@latchflow/db");
    const admin = await prisma.user.upsert({
      where: { email: "e2e.plugins@example.com" },
      update: {},
      create: { email: "e2e.plugins@example.com", role: "ADMIN" as any },
    });
    ADMIN_ID = admin.id;
    const S = Math.random().toString(36).slice(2, 8);
    const { p2 } = await seedPlugins(S);

    const hCaps = handlers.get("GET /capabilities")!;
    const rc1 = createResponseCapture();
    await hCaps({ headers: {} } as any, rc1.res);
    expect(rc1.status).toBe(200);
    expect(Array.isArray(rc1.body?.items)).toBe(true);
    expect(rc1.body.items.length).toBeGreaterThanOrEqual(3);

    // Filter kind=ACTION
    const rc2 = createResponseCapture();
    await hCaps({ headers: {}, query: { kind: "ACTION" } } as any, rc2.res);
    expect(rc2.status).toBe(200);
    expect(rc2.body.items.every((c: any) => c.kind === "ACTION")).toBe(true);

    // Filter by pluginId
    const rc3 = createResponseCapture();
    await hCaps({ headers: {}, query: { pluginId: p2.id } } as any, rc3.res);
    expect(rc3.status).toBe(200);
    expect(rc3.body.items.every((c: any) => c.key === "webhook")).toBe(true);
  });

  it("POST /plugins/install validates and returns 202; DELETE removes plugin", async () => {
    const { handlers, server } = makeServer();
    const { registerPluginRoutes } = await import("../../src/routes/admin/plugins.js");
    registerPluginRoutes(server);

    const { prisma } = await import("@latchflow/db");
    const admin = await prisma.user.upsert({
      where: { email: "e2e.plugins@example.com" },
      update: {},
      create: { email: "e2e.plugins@example.com", role: "ADMIN" as any },
    });
    ADMIN_ID = admin.id;
    const S = Math.random().toString(36).slice(2, 8);
    const plugin = await prisma.plugin.create({ data: { name: `e2e_plugin_gamma_${S}` } });

    const hInstall = handlers.get("POST /plugins/install")!;
    const rc1 = createResponseCapture();
    await hInstall({ headers: {}, body: { source: "file:./plugins/x" } } as any, rc1.res);
    expect(rc1.status).toBe(202);

    const hDel = handlers.get("DELETE /plugins/:pluginId")!;
    const rc2 = createResponseCapture();
    await hDel({ headers: {}, params: { pluginId: plugin.id } } as any, rc2.res);
    expect(rc2.status).toBe(204);
    const exists = await prisma.plugin.findUnique({ where: { id: plugin.id } });
    expect(exists).toBeNull();
  });
});
