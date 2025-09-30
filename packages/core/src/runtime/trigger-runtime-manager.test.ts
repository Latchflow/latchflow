import { describe, it, expect, vi, beforeEach } from "vitest";
import { TriggerRuntimeManager } from "./trigger-runtime-manager.js";
import { PluginRuntimeRegistry } from "../plugins/plugin-loader.js";
import { createStubPluginServiceRegistry } from "../services/stubs.js";

function createRuntimeRegistry() {
  return new PluginRuntimeRegistry(createStubPluginServiceRegistry());
}

describe("TriggerRuntimeManager", () => {
  const triggerFactory = vi.fn(() => ({
    start: vi.fn(async () => {}),
    stop: vi.fn(async () => {}),
  }));
  const fireTrigger = vi.fn(async () => "evt_1");
  const capId = "cap_1";
  const pluginName = "fake";

  const registry = createRuntimeRegistry();
  registry.registerTrigger({
    pluginName,
    capabilityId: capId,
    capability: { kind: "TRIGGER", key: "cron", displayName: "Cron" },
    factory: triggerFactory,
  });

  const db = {
    triggerDefinition: {
      findMany: vi.fn(async () => [{ id: "def_1", capabilityId: capId, config: { foo: "bar" } }]),
      findUnique: vi.fn(async () => ({
        id: "def_1",
        capabilityId: capId,
        config: { foo: "baz" },
        isEnabled: true,
      })),
    },
  } as unknown as Parameters<TriggerRuntimeManager["constructor"]>[0]["db"];

  beforeEach(() => {
    fireTrigger.mockClear();
    triggerFactory.mockClear();
    (registry as unknown as { removePlugin: PluginRuntimeRegistry["removePlugin"] }).removePlugin =
      PluginRuntimeRegistry.prototype.removePlugin.bind(registry);
  });

  it("starts trigger runtimes and wires emit", async () => {
    const manager = new TriggerRuntimeManager({
      db,
      registry,
      fireTrigger,
      encryption: { mode: "none" },
    });
    await manager.startAll();
    const runtimeInstance = triggerFactory.mock.results[0].value as Awaited<
      ReturnType<typeof triggerFactory>
    >;
    expect(runtimeInstance.start).toHaveBeenCalledTimes(1);
    const ctx = triggerFactory.mock.calls[0][0];
    await ctx.services.emit({ context: { hello: "world" } });
    expect(fireTrigger).toHaveBeenCalledWith("def_1", { context: { hello: "world" } });
    await manager.stopAll();
  });

  it("reloads triggers with updated config", async () => {
    const runtime = new TriggerRuntimeManager({
      db,
      registry,
      fireTrigger,
      encryption: { mode: "none" },
    });
    await runtime.startAll();
    await runtime.reloadTrigger("def_1");
    expect(triggerFactory).toHaveBeenCalledTimes(2);
  });
});
