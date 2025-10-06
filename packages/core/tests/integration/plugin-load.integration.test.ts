import { describe, it, expect, vi, beforeEach } from "vitest";
import { PluginRuntimeRegistry } from "../../src/plugins/plugin-loader.js";
import { createStubPluginServiceRegistry } from "../../src/services/stubs.js";
import { createMemoryQueue } from "../../src/queue/memory-queue.js";
import type { ActionFactory } from "../../src/plugins/contracts.js";

const dbMocks = vi.hoisted(() => {
  const invocations = new Map<string, any>();
  let invocationCounter = 0;

  return {
    invocations,
    create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
      const id = `inv_${++invocationCounter}`;
      const inv = { id, ...data };
      invocations.set(id, inv);
      return inv;
    }),
    update: vi.fn(
      async ({ where: { id }, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const inv = invocations.get(id);
        if (inv) {
          Object.assign(inv, data);
        }
        return inv;
      },
    ),
    findUnique: vi.fn(async ({ where }: { where: { id: string } }) => ({
      id: where.id,
      capabilityId: where.id,
      config: {},
      isEnabled: true,
    })),
    reset() {
      invocations.clear();
      invocationCounter = 0;
      this.create.mockClear();
      this.update.mockClear();
      this.findUnique.mockClear();
    },
  };
});

vi.mock("../../src/db/db.js", () => ({
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

import { startActionConsumer } from "../../src/runtime/action-runner.js";

describe("Plugin Load Testing", () => {
  beforeEach(() => {
    dbMocks.reset();
  });

  describe("Queue Processing with Multiple Plugins", () => {
    it("processes actions from multiple plugins concurrently", async () => {
      const executionOrder: string[] = [];
      const executionTimes: number[] = [];

      // Create slow action factories to test concurrency
      const createSlowAction = (pluginName: string, delay: number): ActionFactory => {
        return async () => ({
          execute: vi.fn(async () => {
            const start = Date.now();
            executionOrder.push(pluginName);
            await new Promise((resolve) => setTimeout(resolve, delay));
            executionTimes.push(Date.now() - start);
            return { output: { plugin: pluginName } };
          }),
        });
      };

      const registry = new PluginRuntimeRegistry(createStubPluginServiceRegistry());

      // Register 3 different plugins with actions
      registry.registerAction({
        pluginName: "plugin-a",
        pluginId: "plugin-a-id",
        capabilityId: "cap_a",
        capability: { kind: "ACTION", key: "action-a", displayName: "Action A" },
        factory: createSlowAction("plugin-a", 100),
      });

      registry.registerAction({
        pluginName: "plugin-b",
        pluginId: "plugin-b-id",
        capabilityId: "cap_b",
        capability: { kind: "ACTION", key: "action-b", displayName: "Action B" },
        factory: createSlowAction("plugin-b", 100),
      });

      registry.registerAction({
        pluginName: "plugin-c",
        pluginId: "plugin-c-id",
        capabilityId: "cap_c",
        capability: { kind: "ACTION", key: "action-c", displayName: "Action C" },
        factory: createSlowAction("plugin-c", 100),
      });

      const queue = await createMemoryQueue({ config: null });

      await startActionConsumer(queue, {
        registry,
        encryption: { mode: "none" },
      });

      // Enqueue actions from all three plugins
      const startTime = Date.now();
      await queue.enqueueAction({ actionDefinitionId: "cap_a" });
      await queue.enqueueAction({ actionDefinitionId: "cap_b" });
      await queue.enqueueAction({ actionDefinitionId: "cap_c" });

      // Wait for all to complete
      await vi.waitFor(
        () => {
          expect(executionOrder).toHaveLength(3);
        },
        { timeout: 5000, interval: 50 },
      );

      const totalTime = Date.now() - startTime;

      // All three should execute (order may vary due to concurrency)
      expect(executionOrder).toContain("plugin-a");
      expect(executionOrder).toContain("plugin-b");
      expect(executionOrder).toContain("plugin-c");

      // With concurrency, total time should be ~100ms, not ~300ms
      // Allow some overhead but verify they ran concurrently
      expect(totalTime).toBeLessThan(250);

      await queue.stop();
    });

    it("respects concurrency limits", async () => {
      const concurrentExecutions: number[] = [];
      let currentConcurrent = 0;
      let maxConcurrent = 0;

      const trackingAction: ActionFactory = async () => ({
        execute: vi.fn(async () => {
          currentConcurrent++;
          maxConcurrent = Math.max(maxConcurrent, currentConcurrent);
          concurrentExecutions.push(currentConcurrent);
          await new Promise((resolve) => setTimeout(resolve, 50));
          currentConcurrent--;
          return { output: {} };
        }),
      });

      const registry = new PluginRuntimeRegistry(createStubPluginServiceRegistry());
      registry.registerAction({
        pluginName: "test-plugin",
        pluginId: "test-plugin-id",
        capabilityId: "cap_test",
        capability: { kind: "ACTION", key: "test", displayName: "Test" },
        factory: trackingAction,
      });

      const queue = await createMemoryQueue({ config: null });

      await startActionConsumer(queue, {
        registry,
        encryption: { mode: "none" },
      });

      // Enqueue 20 actions quickly
      const enqueuePromises = [];
      for (let i = 0; i < 20; i++) {
        enqueuePromises.push(queue.enqueueAction({ actionDefinitionId: "cap_test" }));
      }
      await Promise.all(enqueuePromises);

      // Wait for all to complete
      await vi.waitFor(
        () => {
          expect(concurrentExecutions).toHaveLength(20);
        },
        { timeout: 10000, interval: 50 },
      );

      // The default concurrency limit is 10 (or env var PLUGIN_ACTION_CONCURRENCY)
      const expectedLimit = Number(process.env.PLUGIN_ACTION_CONCURRENCY || 10);
      expect(maxConcurrent).toBeLessThanOrEqual(expectedLimit);
      expect(maxConcurrent).toBeGreaterThan(0);

      await queue.stop();
    });
  });

  describe("Plugin Execution Under Backlog Conditions", () => {
    it("processes queued actions even with backlog", async () => {
      const processedActions: string[] = [];

      const simpleAction: ActionFactory = async () => ({
        execute: vi.fn(async (input) => {
          processedActions.push(input.invocation.invocationId);
          await new Promise((resolve) => setTimeout(resolve, 10));
          return { output: { processed: true } };
        }),
      });

      const registry = new PluginRuntimeRegistry(createStubPluginServiceRegistry());
      registry.registerAction({
        pluginName: "backlog-test",
        pluginId: "backlog-test-id",
        capabilityId: "cap_backlog",
        capability: { kind: "ACTION", key: "backlog", displayName: "Backlog Test" },
        factory: simpleAction,
      });

      const queue = await createMemoryQueue({ config: null });

      // Enqueue 50 actions BEFORE starting consumer (creating backlog)
      const enqueueCount = 50;
      for (let i = 0; i < enqueueCount; i++) {
        await queue.enqueueAction({ actionDefinitionId: "cap_backlog" });
      }

      // Now start the consumer
      await startActionConsumer(queue, {
        registry,
        encryption: { mode: "none" },
      });

      // Wait for all to be processed
      await vi.waitFor(
        () => {
          expect(processedActions).toHaveLength(enqueueCount);
        },
        { timeout: 15000, interval: 100 },
      );

      expect(processedActions).toHaveLength(enqueueCount);
      // Verify all invocation IDs are unique
      const uniqueIds = new Set(processedActions);
      expect(uniqueIds.size).toBe(enqueueCount);

      await queue.stop();
    });

    it("maintains action ordering from same trigger", async () => {
      const executionOrder: Array<{ triggerId: string; actionId: string; timestamp: number }> = [];

      const orderTrackingAction: ActionFactory = async () => ({
        execute: vi.fn(async (input) => {
          executionOrder.push({
            triggerId: input.invocation.triggerEventId || "manual",
            actionId: input.invocation.invocationId,
            timestamp: Date.now(),
          });
          await new Promise((resolve) => setTimeout(resolve, 5));
          return { output: {} };
        }),
      });

      const registry = new PluginRuntimeRegistry(createStubPluginServiceRegistry());
      registry.registerAction({
        pluginName: "order-test",
        pluginId: "order-test-id",
        capabilityId: "cap_order",
        capability: { kind: "ACTION", key: "order", displayName: "Order Test" },
        factory: orderTrackingAction,
      });

      const queue = await createMemoryQueue({ config: null });

      await startActionConsumer(queue, {
        registry,
        encryption: { mode: "none" },
      });

      // Enqueue actions from trigger A
      await queue.enqueueAction({
        actionDefinitionId: "cap_order",
        triggerEventId: "trigger_a",
      });
      await queue.enqueueAction({
        actionDefinitionId: "cap_order",
        triggerEventId: "trigger_a",
      });
      await queue.enqueueAction({
        actionDefinitionId: "cap_order",
        triggerEventId: "trigger_a",
      });

      // Wait for all to complete
      await vi.waitFor(
        () => {
          expect(executionOrder).toHaveLength(3);
        },
        { timeout: 5000, interval: 50 },
      );

      // All should be from trigger_a and processed in order
      const triggerAActions = executionOrder.filter((e) => e.triggerId === "trigger_a");
      expect(triggerAActions).toHaveLength(3);

      // Verify timestamps are in ascending order (FIFO)
      for (let i = 1; i < triggerAActions.length; i++) {
        expect(triggerAActions[i].timestamp).toBeGreaterThanOrEqual(
          triggerAActions[i - 1].timestamp,
        );
      }

      await queue.stop();
    });

    it("handles mixed fast and slow actions efficiently", async () => {
      const fastCompleted: string[] = [];
      const slowCompleted: string[] = [];

      const fastAction: ActionFactory = async () => ({
        execute: vi.fn(async (input) => {
          fastCompleted.push(input.invocation.invocationId);
          await new Promise((resolve) => setTimeout(resolve, 5));
          return { output: { speed: "fast" } };
        }),
      });

      const slowAction: ActionFactory = async () => ({
        execute: vi.fn(async (input) => {
          slowCompleted.push(input.invocation.invocationId);
          await new Promise((resolve) => setTimeout(resolve, 100));
          return { output: { speed: "slow" } };
        }),
      });

      const registry = new PluginRuntimeRegistry(createStubPluginServiceRegistry());
      registry.registerAction({
        pluginName: "fast-plugin",
        pluginId: "fast-plugin-id",
        capabilityId: "cap_fast",
        capability: { kind: "ACTION", key: "fast", displayName: "Fast Action" },
        factory: fastAction,
      });

      registry.registerAction({
        pluginName: "slow-plugin",
        pluginId: "slow-plugin-id",
        capabilityId: "cap_slow",
        capability: { kind: "ACTION", key: "slow", displayName: "Slow Action" },
        factory: slowAction,
      });

      const queue = await createMemoryQueue({ config: null });

      await startActionConsumer(queue, {
        registry,
        encryption: { mode: "none" },
      });

      const startTime = Date.now();

      // Enqueue slow actions first
      await queue.enqueueAction({ actionDefinitionId: "cap_slow" });
      await queue.enqueueAction({ actionDefinitionId: "cap_slow" });

      // Then enqueue fast actions
      await queue.enqueueAction({ actionDefinitionId: "cap_fast" });
      await queue.enqueueAction({ actionDefinitionId: "cap_fast" });
      await queue.enqueueAction({ actionDefinitionId: "cap_fast" });

      // Fast actions should complete even while slow ones are running
      await vi.waitFor(
        () => {
          expect(fastCompleted.length).toBeGreaterThanOrEqual(1);
        },
        { timeout: 5000, interval: 20 },
      );

      const fastFirstCompletedTime = Date.now() - startTime;

      // Fast actions should start completing quickly even though slow actions started first
      // This proves concurrency is working (allow some overhead for test execution)
      expect(fastFirstCompletedTime).toBeLessThan(250);

      // Wait for all to complete
      await vi.waitFor(
        () => {
          expect(fastCompleted).toHaveLength(3);
          expect(slowCompleted).toHaveLength(2);
        },
        { timeout: 5000, interval: 50 },
      );

      await queue.stop();
    });
  });
});
