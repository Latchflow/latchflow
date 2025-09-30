import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { startActionConsumer } from "../runtime/action-runner.js";
import { createMemoryQueue } from "../queue/memory-queue.js";
import { getDb } from "../db/db.js";
import { PluginRuntimeRegistry } from "../plugins/plugin-loader.js";
import { createStubPluginServiceRegistry } from "../services/stubs.js";
import { PluginServiceError } from "../services/errors.js";

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

  afterEach(() => {
    vi.useRealTimers();
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
    await vi.waitFor(() => {
      expect(getDb().actionInvocation.update).toHaveBeenCalled();
    });
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
    const updateCall = dbClient.actionInvocation.update.mock.calls[0]?.[0];
    expect(updateCall).toEqual(
      expect.objectContaining({
        where: { id: "inv_1" },
        data: expect.objectContaining({ status: "SUCCESS", retryAt: null }),
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
    await vi.waitFor(() => {
      expect(getDb().actionInvocation.update).toHaveBeenCalled();
    });
    const dbClient = getDb() as any;
    const updateCall = dbClient.actionInvocation.update.mock.calls[0]?.[0];
    expect(updateCall).toEqual(
      expect.objectContaining({
        data: expect.objectContaining({ status: "SKIPPED_DISABLED" }),
      }),
    );
  });

  it("retries when runtime requests retry", async () => {
    vi.useFakeTimers();
    const queue = await createMemoryQueue({ config: null });
    const registry = new PluginRuntimeRegistry(createStubPluginServiceRegistry());
    const execute = vi
      .fn<[], Promise<{ retry?: { delayMs?: number } | undefined } | { output?: unknown }>>()
      .mockResolvedValueOnce({ retry: { delayMs: 1000 } })
      .mockResolvedValueOnce({ output: { ok: true } });
    registry.registerAction({
      pluginName: "fake",
      capabilityId: "cap_a",
      capability: { kind: "ACTION", key: "email", displayName: "Email" },
      factory: vi.fn(async () => ({ execute, dispose: vi.fn(async () => {}) })),
    });

    await startActionConsumer(queue, { registry });
    const enqueueSpy = vi.spyOn(queue, "enqueueAction");
    await queue.enqueueAction({ actionDefinitionId: "A" });

    await vi.waitFor(() => {
      expect(getDb().actionInvocation.update).toHaveBeenCalled();
    });

    const dbClient = getDb() as any;
    const firstUpdateCall = dbClient.actionInvocation.update.mock.calls[0]?.[0];
    expect(firstUpdateCall?.data).toEqual(expect.objectContaining({ status: "RETRYING" }));

    await vi.advanceTimersByTimeAsync(1000);
    await vi.waitFor(() => {
      expect(dbClient.actionInvocation.create).toHaveBeenCalledTimes(2);
    });
    expect(enqueueSpy).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it("marks permanent failure on fatal plugin error", async () => {
    const queue = await createMemoryQueue({ config: null });
    const registry = new PluginRuntimeRegistry(createStubPluginServiceRegistry());
    registry.registerAction({
      pluginName: "fake",
      capabilityId: "cap_a",
      capability: { kind: "ACTION", key: "email", displayName: "Email" },
      factory: vi.fn(async () => ({
        execute: vi.fn(async () => {
          throw new PluginServiceError({ kind: "FATAL", code: "FATAL", message: "boom" });
        }),
      })),
    });

    await startActionConsumer(queue, { registry });
    await queue.enqueueAction({ actionDefinitionId: "A" });
    await vi.waitFor(() => {
      expect(getDb().actionInvocation.update).toHaveBeenCalled();
    });
    const dbClient = getDb() as any;
    const updateCall = dbClient.actionInvocation.update.mock.calls[0]?.[0];
    expect(updateCall).toEqual(
      expect.objectContaining({
        data: expect.objectContaining({ status: "FAILED_PERMANENT" }),
      }),
    );
  });
});
