import { describe, it, expect, beforeAll, vi } from "vitest";
import type { HttpHandler, HttpServer } from "../../src/http/http-server.js";
import { getEnv } from "@tests/helpers/containers";
import { createResponseCapture } from "@tests/helpers/response";

// Bypass auth; attach synthetic admin user id on requests
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
    patch: (p, h) => {
      handlers.set(`PATCH ${p}`, h);
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

async function seedPluginWithTriggerAndAction() {
  const { prisma } = await import("@latchflow/db");
  const p = await prisma.plugin.create({ data: { name: `e2e_triggers_${Date.now()}` } });
  const trig = await prisma.pluginCapability.create({
    data: {
      pluginId: p.id,
      kind: "TRIGGER",
      key: "cron",
      displayName: "Cron Schedule",
      jsonSchema: { type: "object" },
      isEnabled: true,
    },
  });
  const act = await prisma.pluginCapability.create({
    data: {
      pluginId: p.id,
      kind: "ACTION",
      key: "email",
      displayName: "Email Notify",
      jsonSchema: { type: "object" },
      isEnabled: true,
    },
  });
  return { plugin: p, trigCap: trig, actCap: act };
}

describe("E2E: Triggers endpoints", () => {
  beforeAll(() => {
    // Ensure containers env is initialized (DATABASE_URL set by e2e setup)
    expect(getEnv().postgres.url).toBeTruthy();
  });

  it("create → update → link pipeline → test-fire → list → delete behavior", async () => {
    const { handlers, server } = makeServer();
    const { registerTriggerAdminRoutes } = await import("../../src/routes/admin/triggers.js");
    const { startTriggerRunner } = await import("../../src/runtime/trigger-runner.js");

    const { prisma } = await import("@latchflow/db");
    const admin = await prisma.user.upsert({
      where: { email: "e2e.triggers@example.com" },
      update: {},
      create: { email: "e2e.triggers@example.com", role: "ADMIN" as any },
    });
    ADMIN_ID = admin.id;

    const seed = await seedPluginWithTriggerAndAction();

    // Runner: onFire immediately creates ActionInvocation rows (simulate queue consumer)
    const runner = await startTriggerRunner({
      onFire: async (msg: {
        actionDefinitionId: string;
        triggerEventId: string;
        context?: any;
      }) => {
        await prisma.actionInvocation.create({
          data: {
            actionDefinitionId: msg.actionDefinitionId,
            triggerEventId: msg.triggerEventId,
            status: "PENDING",
          },
        });
      },
    });

    registerTriggerAdminRoutes(server, {
      fireTriggerOnce: runner.fireTriggerOnce,
      config: {
        HISTORY_SNAPSHOT_INTERVAL: 20,
        HISTORY_MAX_CHAIN_DEPTH: 200,
        SYSTEM_USER_ID: ADMIN_ID,
      } as any,
    });

    // Create trigger
    const hCreate = handlers.get("POST /triggers")!;
    const rcCreate = createResponseCapture();
    await hCreate(
      {
        headers: {},
        body: {
          name: "Cron Trigger",
          capabilityId: seed.trigCap.id,
          config: { schedule: "* * * * *" },
        },
      } as any,
      rcCreate.res,
    );
    expect(rcCreate.status).toBe(201);
    const triggerId = rcCreate.body.id as string;

    // Update: disable
    const hUpdate = handlers.get("PATCH /triggers/:id")!;
    const rcUpdate = createResponseCapture();
    await hUpdate(
      { headers: {}, params: { id: triggerId }, body: { isEnabled: false } } as any,
      rcUpdate.res,
    );
    expect(rcUpdate.status).toBe(204);
    const updated = await prisma.triggerDefinition.findUnique({ where: { id: triggerId } });
    expect(updated?.isEnabled).toBe(false);

    // Create action and pipeline linking to the trigger
    const action = await prisma.actionDefinition.create({
      data: {
        name: "Email",
        capabilityId: seed.actCap.id,
        config: {},
        createdBy: ADMIN_ID,
      },
    });
    const pipeline = await prisma.pipeline.create({
      data: { name: "P1", isEnabled: true, createdBy: ADMIN_ID },
    });
    await prisma.pipelineStep.create({
      data: {
        pipelineId: pipeline.id,
        actionId: action.id,
        sortOrder: 1,
        isEnabled: true,
        createdBy: ADMIN_ID,
      },
    });
    await prisma.pipelineTrigger.create({
      data: {
        pipelineId: pipeline.id,
        triggerId: triggerId,
        sortOrder: 1,
        isEnabled: true,
        createdBy: ADMIN_ID,
      },
    });

    // Re-enable trigger for firing
    const rcUpdate2 = createResponseCapture();
    await hUpdate(
      { headers: {}, params: { id: triggerId }, body: { isEnabled: true } } as any,
      rcUpdate2.res,
    );
    expect(rcUpdate2.status).toBe(204);

    // Test-fire
    const hFire = handlers.get("POST /triggers/:id/test-fire")!;
    const rcFire = createResponseCapture();
    await hFire(
      { headers: {}, params: { id: triggerId }, body: { context: { foo: "bar" } } } as any,
      rcFire.res,
    );
    expect(rcFire.status).toBe(202);

    // Verify TriggerEvent and ActionInvocation persisted
    const evts = await prisma.triggerEvent.findMany({ where: { triggerDefinitionId: triggerId } });
    expect(evts.length).toBeGreaterThanOrEqual(1);
    const invs = await prisma.actionInvocation.findMany({ where: { triggerEventId: evts[0].id } });
    expect(invs.length).toBeGreaterThanOrEqual(1);

    // List with filters
    const hList = handlers.get("GET /triggers")!;
    const rcList = createResponseCapture();
    await hList(
      { headers: {}, query: { pluginId: seed.plugin.id, capabilityKey: "cron", q: "Cron" } } as any,
      rcList.res,
    );
    expect(rcList.status).toBe(200);
    expect(Array.isArray(rcList.body?.items)).toBe(true);
    expect(rcList.body.items.some((t: any) => t.id === triggerId)).toBe(true);

    // Delete should now fail with 409 due to usage/linkage
    const hDel = handlers.get("DELETE /triggers/:id")!;
    const rcDelFail = createResponseCapture();
    await hDel({ headers: {}, params: { id: triggerId } } as any, rcDelFail.res);
    expect(rcDelFail.status).toBe(409);

    // Create an unused trigger and delete it
    const rcCreate2 = createResponseCapture();
    await hCreate(
      {
        headers: {},
        body: { name: "Temp Trigger", capabilityId: seed.trigCap.id, config: {} },
      } as any,
      rcCreate2.res,
    );
    const tempId = rcCreate2.body.id as string;
    const rcDelOk = createResponseCapture();
    await hDel({ headers: {}, params: { id: tempId } } as any, rcDelOk.res);
    expect(rcDelOk.status).toBe(204);
    const missing = await prisma.triggerDefinition.findUnique({ where: { id: tempId } });
    expect(missing).toBeNull();
  });
});
