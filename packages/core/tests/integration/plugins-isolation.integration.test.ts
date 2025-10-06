import { describe, it, expect, vi } from "vitest";
import { createMemoryQueue } from "../../src/queue/memory-queue.js";
import { startActionConsumer } from "../../src/runtime/action-runner.js";
import { PluginRuntimeRegistry } from "../../src/plugins/plugin-loader.js";
import { createStubPluginServiceRegistry } from "../../src/services/stubs.js";
import type { PluginServiceRegistry } from "../../src/services/plugin-services.js";

const actionDefinitions = new Map(
  Object.entries({
    def_plugin_a: {
      id: "def_plugin_a",
      capabilityId: "cap_plugin_a",
      config: { template: "A" },
      isEnabled: true,
    },
    def_plugin_b: {
      id: "def_plugin_b",
      capabilityId: "cap_plugin_b",
      config: { template: "B" },
      isEnabled: true,
    },
  }),
);

const invocationCreates: Array<Record<string, unknown>> = [];
const invocationUpdates: Array<Record<string, unknown>> = [];

const db = {
  actionInvocation: {
    create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
      const record = { id: `inv_${invocationCreates.length + 1}`, ...data };
      invocationCreates.push(record);
      return record;
    }),
    update: vi.fn(
      async ({ where: { id }, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const record = { id, ...data };
        invocationUpdates.push(record);
        return record;
      },
    ),
  },
  actionDefinition: {
    findUnique: vi.fn(async ({ where: { id } }: { where: { id: string } }) => {
      const original = actionDefinitions.get(id);
      return original ? structuredClone(original) : null;
    }),
  },
} as const;

vi.mock("../../src/db/db.js", () => ({
  getDb: () => db,
}));

describe("plugin isolation", () => {
  it("keeps action executions isolated per plugin", async () => {
    const recordedServiceContexts: unknown[] = [];
    const serviceInstances: unknown[] = [];
    const registry = createStubPluginServiceRegistry();

    const originalCreateScoped = registry.createScopedServices.bind(registry);
    (
      registry as PluginServiceRegistry & {
        createScopedServices: typeof registry.createScopedServices;
      }
    ).createScopedServices = function patched(baseContext) {
      recordedServiceContexts.push({ ...baseContext });
      const services = originalCreateScoped(baseContext);
      serviceInstances.push(services);
      return services;
    };

    const runtime = new PluginRuntimeRegistry(registry);
    const queue = await createMemoryQueue({ config: null });

    const capturedConfigs: Array<{ plugin: string; config: Record<string, unknown> }> = [];
    const runtimeServices: unknown[] = [];
    const runtimeContexts: unknown[] = [];

    runtime.registerAction({
      pluginName: "plugin-a",
      pluginId: "plug_a",
      capabilityId: "cap_plugin_a",
      capability: { kind: "ACTION", key: "notify_a", displayName: "Notify A" },
      factory: vi.fn(async (ctx) => {
        runtimeContexts.push(ctx);
        runtimeServices.push(ctx.services);
        return {
          execute: async ({ config }) => {
            capturedConfigs.push({
              plugin: "plugin-a",
              config: structuredClone(config as Record<string, unknown>),
            });
            (config as Record<string, unknown>).mutatedBy = "plugin-a";
            return { output: { ok: true } };
          },
        };
      }),
    });

    runtime.registerAction({
      pluginName: "plugin-b",
      pluginId: "plug_b",
      capabilityId: "cap_plugin_b",
      capability: { kind: "ACTION", key: "notify_b", displayName: "Notify B" },
      factory: vi.fn(async (ctx) => {
        runtimeContexts.push(ctx);
        runtimeServices.push(ctx.services);
        return {
          execute: async ({ config }) => {
            capturedConfigs.push({
              plugin: "plugin-b",
              config: structuredClone(config as Record<string, unknown>),
            });
            return { output: { ok: true } };
          },
        };
      }),
    });

    await startActionConsumer(queue, { registry: runtime, encryption: { mode: "none" } });

    await queue.enqueueAction({ actionDefinitionId: "def_plugin_a" });
    await queue.enqueueAction({ actionDefinitionId: "def_plugin_b" });

    await vi.waitFor(() => {
      expect(invocationUpdates.length).toBeGreaterThanOrEqual(2);
    });

    await queue.stop();

    expect(recordedServiceContexts).toHaveLength(2);
    expect((recordedServiceContexts[0] as { pluginName: string }).pluginName).toBe("plugin-a");
    expect((recordedServiceContexts[1] as { pluginName: string }).pluginName).toBe("plugin-b");

    expect(serviceInstances).toHaveLength(2);
    expect(serviceInstances[0]).not.toBe(serviceInstances[1]);

    expect(runtimeServices).toHaveLength(2);
    expect(runtimeServices[0]).not.toBe(runtimeServices[1]);
    expect((runtimeServices[0] as { core: unknown }).core).not.toBe(
      (runtimeServices[1] as { core: unknown }).core,
    );

    expect(capturedConfigs).toEqual([
      { plugin: "plugin-a", config: { template: "A" } },
      { plugin: "plugin-b", config: { template: "B" } },
    ]);

    expect(actionDefinitions.get("def_plugin_a")?.config).toEqual({ template: "A" });
    expect(actionDefinitions.get("def_plugin_b")?.config).toEqual({ template: "B" });
  });
});
