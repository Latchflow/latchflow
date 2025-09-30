import { describe, it, expect, vi, beforeEach } from "vitest";
import { startActionConsumer } from "../runtime/action-runner.js";
import { createMemoryQueue } from "../queue/memory-queue.js";
import { getDb } from "../db/db.js";
import { PluginRuntimeRegistry } from "../plugins/plugin-loader.js";
import { createStubPluginServiceRegistry } from "../services/stubs.js";

const dbMocks = vi.hoisted(() => {
  const definition = {
    id: "act_def_1",
    capabilityId: "cap_a",
    config: { foo: "bar" },
    isEnabled: true,
  };
  const invocationCreates: unknown[] = [];
  const invocationUpdates: unknown[] = [];
  const create = vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
    const obj = { id: "inv_1", ...data };
    invocationCreates.push(obj);
    return obj;
  });
  const update = vi.fn(
    async ({ where: { id }, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      invocationUpdates.push({ id, data });
      return { id, ...data } as Record<string, unknown>;
    },
  );
  const findUnique = vi.fn(async () => ({ ...definition }));
  return {
    definition,
    invocationCreates,
    invocationUpdates,
    create,
    update,
    findUnique,
    reset() {
      invocationCreates.length = 0;
      invocationUpdates.length = 0;
      definition.isEnabled = true;
      create.mockClear();
      update.mockClear();
      findUnique.mockClear();
    },
  };
});

vi.mock("../db/db.js", () => ({
  getDb: () => ({
    actionInvocation: {
      create: dbMocks.create,
      update: dbMocks.update,
    },
    actionDefinition: {
      findUnique: dbMocks.findUnique,
    },
  }),
}));

describe("action-runner", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbMocks.reset();
  });

  it("creates and finalizes invocation for successful action", async () => {
    const queue = await createMemoryQueue({ config: null });
    const registry = new PluginRuntimeRegistry(createStubPluginServiceRegistry());
    const execute = vi.fn(async () => ({ output: { ok: true } }));
    registry.registerAction({
      pluginName: "fake",
      capabilityId: "cap_a",
      capability: { kind: "ACTION", key: "email", displayName: "Email" },
      factory: vi.fn(async () => ({
        execute,
        dispose: vi.fn(async () => {}),
      })),
    });

    await startActionConsumer(queue, { registry });
    await queue.enqueueAction({
      actionDefinitionId: "A",
      triggerEventId: "T",
      manualInvokerId: "tester",
    });
    await new Promise((r) => setTimeout(r, 10));
    const dbClient = getDb() as any;
    expect(dbClient.actionInvocation.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ manualInvokerId: "tester" }),
      }),
    );
    expect(dbClient.actionDefinition.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "A" } }),
    );
    expect(execute).toHaveBeenCalledTimes(1);
    expect(dbClient.actionInvocation.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "inv_1" },
        data: expect.objectContaining({ status: "SUCCESS" }),
      }),
    );
  });

  it("skips disabled actions", async () => {
    const queue = await createMemoryQueue({ config: null });
    const registry = new PluginRuntimeRegistry(createStubPluginServiceRegistry());
    registry.registerAction({
      pluginName: "fake",
      capabilityId: "cap_a",
      capability: { kind: "ACTION", key: "email", displayName: "Email" },
      factory: vi.fn(async () => ({ execute: vi.fn() })),
    });
    dbMocks.definition.isEnabled = false;
    await startActionConsumer(queue, { registry });
    await queue.enqueueAction({ actionDefinitionId: "A" });
    await new Promise((r) => setTimeout(r, 10));
    const dbClient = getDb() as any;
    expect(dbClient.actionInvocation.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "SKIPPED_DISABLED" }),
      }),
    );
  });
});
