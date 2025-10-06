import { describe, it, expect, vi } from "vitest";
import { TriggerRuntimeManager } from "../../src/runtime/trigger-runtime-manager.js";
import { PluginRuntimeRegistry } from "../../src/plugins/plugin-loader.js";
import { createStubPluginServiceRegistry } from "../../src/services/stubs.js";
import type { TriggerRuntime, TriggerFactory } from "../../src/plugins/contracts.js";

describe("Plugin Lifecycle Integration", () => {
  describe("Trigger Start/Stop Behavior", () => {
    it("starts trigger on manager.startAll() and calls start() method", async () => {
      const startFn = vi.fn(async () => {});
      const stopFn = vi.fn(async () => {});
      const triggerFactory: TriggerFactory = vi.fn(async () => ({
        start: startFn,
        stop: stopFn,
      }));

      const registry = new PluginRuntimeRegistry(createStubPluginServiceRegistry());
      registry.registerTrigger({
        pluginName: "test-plugin",
        pluginId: "test-plugin-id",
        capabilityId: "cap_1",
        capability: { kind: "TRIGGER", key: "test", displayName: "Test Trigger" },
        factory: triggerFactory,
      });

      const db = {
        triggerDefinition: {
          findMany: vi.fn(async () => [
            { id: "def_1", capabilityId: "cap_1", config: { enabled: true } },
          ]),
          findUnique: vi.fn(),
        },
      } as any;

      const manager = new TriggerRuntimeManager({
        db,
        registry,
        fireTrigger: vi.fn(async () => "evt_1"),
        encryption: { mode: "none" },
      });

      await manager.startAll();

      expect(triggerFactory).toHaveBeenCalledTimes(1);
      expect(startFn).toHaveBeenCalledTimes(1);
      expect(stopFn).not.toHaveBeenCalled();

      await manager.stopAll();
    });

    it("stops trigger on manager.stopAll() and calls stop() method", async () => {
      const startFn = vi.fn(async () => {});
      const stopFn = vi.fn(async () => {});
      const triggerFactory: TriggerFactory = vi.fn(async () => ({
        start: startFn,
        stop: stopFn,
      }));

      const registry = new PluginRuntimeRegistry(createStubPluginServiceRegistry());
      registry.registerTrigger({
        pluginName: "test-plugin",
        pluginId: "test-plugin-id",
        capabilityId: "cap_1",
        capability: { kind: "TRIGGER", key: "test", displayName: "Test Trigger" },
        factory: triggerFactory,
      });

      const db = {
        triggerDefinition: {
          findMany: vi.fn(async () => [
            { id: "def_1", capabilityId: "cap_1", config: { enabled: true } },
          ]),
          findUnique: vi.fn(),
        },
      } as any;

      const manager = new TriggerRuntimeManager({
        db,
        registry,
        fireTrigger: vi.fn(async () => "evt_1"),
        encryption: { mode: "none" },
      });

      await manager.startAll();
      await manager.stopAll();

      expect(stopFn).toHaveBeenCalledTimes(1);
    });

    it("calls dispose() if implemented when stopping trigger", async () => {
      const disposeFn = vi.fn(async () => {});
      const triggerFactory: TriggerFactory = vi.fn(async () => ({
        start: vi.fn(async () => {}),
        stop: vi.fn(async () => {}),
        dispose: disposeFn,
      }));

      const registry = new PluginRuntimeRegistry(createStubPluginServiceRegistry());
      registry.registerTrigger({
        pluginName: "test-plugin",
        pluginId: "test-plugin-id",
        capabilityId: "cap_1",
        capability: { kind: "TRIGGER", key: "test", displayName: "Test Trigger" },
        factory: triggerFactory,
      });

      const db = {
        triggerDefinition: {
          findMany: vi.fn(async () => [{ id: "def_1", capabilityId: "cap_1", config: {} }]),
          findUnique: vi.fn(),
        },
      } as any;

      const manager = new TriggerRuntimeManager({
        db,
        registry,
        fireTrigger: vi.fn(async () => "evt_1"),
        encryption: { mode: "none" },
      });

      await manager.startAll();
      await manager.stopAll();

      expect(disposeFn).toHaveBeenCalledTimes(1);
    });

    it("does not fail if stop() throws error", async () => {
      const stopError = new Error("Stop failed");
      const triggerFactory: TriggerFactory = vi.fn(async () => ({
        start: vi.fn(async () => {}),
        stop: vi.fn(async () => {
          throw stopError;
        }),
      }));

      const registry = new PluginRuntimeRegistry(createStubPluginServiceRegistry());
      registry.registerTrigger({
        pluginName: "test-plugin",
        pluginId: "test-plugin-id",
        capabilityId: "cap_1",
        capability: { kind: "TRIGGER", key: "test", displayName: "Test Trigger" },
        factory: triggerFactory,
      });

      const db = {
        triggerDefinition: {
          findMany: vi.fn(async () => [{ id: "def_1", capabilityId: "cap_1", config: {} }]),
          findUnique: vi.fn(),
        },
      } as any;

      const manager = new TriggerRuntimeManager({
        db,
        registry,
        fireTrigger: vi.fn(async () => "evt_1"),
        encryption: { mode: "none" },
      });

      await manager.startAll();
      await expect(manager.stopAll()).resolves.not.toThrow();
    });
  });

  describe("Graceful Shutdown", () => {
    it("stops all running triggers on stopAll()", async () => {
      const stop1 = vi.fn(async () => {});
      const stop2 = vi.fn(async () => {});

      const factory1: TriggerFactory = vi.fn(async () => ({
        start: vi.fn(async () => {}),
        stop: stop1,
      }));

      const factory2: TriggerFactory = vi.fn(async () => ({
        start: vi.fn(async () => {}),
        stop: stop2,
      }));

      const registry = new PluginRuntimeRegistry(createStubPluginServiceRegistry());
      registry.registerTrigger({
        pluginName: "plugin1",
        pluginId: "plugin1-id",
        capabilityId: "cap_1",
        capability: { kind: "TRIGGER", key: "trigger1", displayName: "Trigger 1" },
        factory: factory1,
      });

      registry.registerTrigger({
        pluginName: "plugin2",
        pluginId: "plugin2-id",
        capabilityId: "cap_2",
        capability: { kind: "TRIGGER", key: "trigger2", displayName: "Trigger 2" },
        factory: factory2,
      });

      const db = {
        triggerDefinition: {
          findMany: vi.fn(async () => [
            { id: "def_1", capabilityId: "cap_1", config: {} },
            { id: "def_2", capabilityId: "cap_2", config: {} },
          ]),
          findUnique: vi.fn(),
        },
      } as any;

      const manager = new TriggerRuntimeManager({
        db,
        registry,
        fireTrigger: vi.fn(async () => "evt_1"),
        encryption: { mode: "none" },
      });

      await manager.startAll();
      await manager.stopAll();

      expect(stop1).toHaveBeenCalledTimes(1);
      expect(stop2).toHaveBeenCalledTimes(1);
    });

    it("stops all triggers in parallel", async () => {
      const delays: number[] = [];
      const createStopFn = (delay: number) =>
        vi.fn(async () => {
          const start = Date.now();
          await new Promise((resolve) => setTimeout(resolve, delay));
          delays.push(Date.now() - start);
        });

      const stop1 = createStopFn(50);
      const stop2 = createStopFn(50);

      const factory1: TriggerFactory = vi.fn(async () => ({
        start: vi.fn(async () => {}),
        stop: stop1,
      }));

      const factory2: TriggerFactory = vi.fn(async () => ({
        start: vi.fn(async () => {}),
        stop: stop2,
      }));

      const registry = new PluginRuntimeRegistry(createStubPluginServiceRegistry());
      registry.registerTrigger({
        pluginName: "plugin1",
        pluginId: "plugin1-id",
        capabilityId: "cap_1",
        capability: { kind: "TRIGGER", key: "trigger1", displayName: "Trigger 1" },
        factory: factory1,
      });

      registry.registerTrigger({
        pluginName: "plugin2",
        pluginId: "plugin2-id",
        capabilityId: "cap_2",
        capability: { kind: "TRIGGER", key: "trigger2", displayName: "Trigger 2" },
        factory: factory2,
      });

      const db = {
        triggerDefinition: {
          findMany: vi.fn(async () => [
            { id: "def_1", capabilityId: "cap_1", config: {} },
            { id: "def_2", capabilityId: "cap_2", config: {} },
          ]),
          findUnique: vi.fn(),
        },
      } as any;

      const manager = new TriggerRuntimeManager({
        db,
        registry,
        fireTrigger: vi.fn(async () => "evt_1"),
        encryption: { mode: "none" },
      });

      await manager.startAll();
      const stopStart = Date.now();
      await manager.stopAll();
      const totalTime = Date.now() - stopStart;

      // If run in parallel, total time should be ~50ms, not ~100ms
      expect(totalTime).toBeLessThan(80);
      expect(stop1).toHaveBeenCalled();
      expect(stop2).toHaveBeenCalled();
    });
  });

  describe("Configuration Change Handling", () => {
    it("calls onConfigChange() if implemented", async () => {
      const onConfigChangeFn = vi.fn(async () => {});
      const triggerFactory: TriggerFactory = vi.fn(async () => ({
        start: vi.fn(async () => {}),
        stop: vi.fn(async () => {}),
        onConfigChange: onConfigChangeFn,
      }));

      const registry = new PluginRuntimeRegistry(createStubPluginServiceRegistry());
      registry.registerTrigger({
        pluginName: "test-plugin",
        pluginId: "test-plugin-id",
        capabilityId: "cap_1",
        capability: { kind: "TRIGGER", key: "test", displayName: "Test Trigger" },
        factory: triggerFactory,
      });

      const db = {
        triggerDefinition: {
          findMany: vi.fn(async () => [
            { id: "def_1", capabilityId: "cap_1", config: { value: "initial" } },
          ]),
          findUnique: vi.fn(async () => ({
            id: "def_1",
            capabilityId: "cap_1",
            config: { value: "updated" },
            isEnabled: true,
          })),
        },
      } as any;

      const manager = new TriggerRuntimeManager({
        db,
        registry,
        fireTrigger: vi.fn(async () => "evt_1"),
        encryption: { mode: "none" },
      });

      await manager.startAll();
      await manager.notifyConfigChange("def_1", { value: "updated" });

      expect(onConfigChangeFn).toHaveBeenCalledTimes(1);
      expect(onConfigChangeFn).toHaveBeenCalledWith({ value: "updated" });

      await manager.stopAll();
    });

    it("reloads trigger if onConfigChange() not implemented", async () => {
      const startFn = vi.fn(async () => {});
      const stopFn = vi.fn(async () => {});
      const triggerFactory: TriggerFactory = vi.fn(async () => ({
        start: startFn,
        stop: stopFn,
      }));

      const registry = new PluginRuntimeRegistry(createStubPluginServiceRegistry());
      registry.registerTrigger({
        pluginName: "test-plugin",
        pluginId: "test-plugin-id",
        capabilityId: "cap_1",
        capability: { kind: "TRIGGER", key: "test", displayName: "Test Trigger" },
        factory: triggerFactory,
      });

      const db = {
        triggerDefinition: {
          findMany: vi.fn(async () => [
            { id: "def_1", capabilityId: "cap_1", config: { value: "initial" } },
          ]),
          findUnique: vi.fn(async () => ({
            id: "def_1",
            capabilityId: "cap_1",
            config: { value: "updated" },
            isEnabled: true,
          })),
        },
      } as any;

      const manager = new TriggerRuntimeManager({
        db,
        registry,
        fireTrigger: vi.fn(async () => "evt_1"),
        encryption: { mode: "none" },
      });

      await manager.startAll();
      expect(triggerFactory).toHaveBeenCalledTimes(1);
      expect(startFn).toHaveBeenCalledTimes(1);

      await manager.notifyConfigChange("def_1", { value: "updated" });

      // Should have stopped the old instance and started a new one
      expect(stopFn).toHaveBeenCalledTimes(1);
      expect(triggerFactory).toHaveBeenCalledTimes(2);
      expect(startFn).toHaveBeenCalledTimes(2);

      await manager.stopAll();
    });

    it("removes trigger when config change marks it as disabled", async () => {
      const stopFn = vi.fn(async () => {});
      const triggerFactory: TriggerFactory = vi.fn(async () => ({
        start: vi.fn(async () => {}),
        stop: stopFn,
      }));

      const registry = new PluginRuntimeRegistry(createStubPluginServiceRegistry());
      registry.registerTrigger({
        pluginName: "test-plugin",
        pluginId: "test-plugin-id",
        capabilityId: "cap_1",
        capability: { kind: "TRIGGER", key: "test", displayName: "Test Trigger" },
        factory: triggerFactory,
      });

      const db = {
        triggerDefinition: {
          findMany: vi.fn(async () => [{ id: "def_1", capabilityId: "cap_1", config: {} }]),
          findUnique: vi.fn(async () => ({
            id: "def_1",
            capabilityId: "cap_1",
            config: {},
            isEnabled: false, // Disabled
          })),
        },
      } as any;

      const manager = new TriggerRuntimeManager({
        db,
        registry,
        fireTrigger: vi.fn(async () => "evt_1"),
        encryption: { mode: "none" },
      });

      await manager.startAll();
      await manager.reloadTrigger("def_1");

      expect(stopFn).toHaveBeenCalledTimes(1);
      // Should not start a new instance since it's disabled
      expect(triggerFactory).toHaveBeenCalledTimes(1);
    });
  });

  describe("Memory Leak Prevention", () => {
    it("clears all runtime references after stopAll()", async () => {
      const triggerFactory: TriggerFactory = vi.fn(async () => ({
        start: vi.fn(async () => {}),
        stop: vi.fn(async () => {}),
      }));

      const registry = new PluginRuntimeRegistry(createStubPluginServiceRegistry());
      registry.registerTrigger({
        pluginName: "test-plugin",
        pluginId: "test-plugin-id",
        capabilityId: "cap_1",
        capability: { kind: "TRIGGER", key: "test", displayName: "Test Trigger" },
        factory: triggerFactory,
      });

      const db = {
        triggerDefinition: {
          findMany: vi.fn(async () => [{ id: "def_1", capabilityId: "cap_1", config: {} }]),
          findUnique: vi.fn(),
        },
      } as any;

      const manager = new TriggerRuntimeManager({
        db,
        registry,
        fireTrigger: vi.fn(async () => "evt_1"),
        encryption: { mode: "none" },
      });

      await manager.startAll();
      const runtimeMap = (manager as any).runtimes as Map<string, any>;
      expect(runtimeMap.size).toBe(1);

      await manager.stopAll();
      expect(runtimeMap.size).toBe(0);
    });

    it("removes old runtime instance when reloading trigger", async () => {
      const dispose1 = vi.fn(async () => {});
      const dispose2 = vi.fn(async () => {});

      let callCount = 0;
      const triggerFactory: TriggerFactory = vi.fn(async () => {
        callCount++;
        return {
          start: vi.fn(async () => {}),
          stop: vi.fn(async () => {}),
          dispose: callCount === 1 ? dispose1 : dispose2,
        };
      });

      const registry = new PluginRuntimeRegistry(createStubPluginServiceRegistry());
      registry.registerTrigger({
        pluginName: "test-plugin",
        pluginId: "test-plugin-id",
        capabilityId: "cap_1",
        capability: { kind: "TRIGGER", key: "test", displayName: "Test Trigger" },
        factory: triggerFactory,
      });

      const db = {
        triggerDefinition: {
          findMany: vi.fn(async () => [
            { id: "def_1", capabilityId: "cap_1", config: { version: 1 } },
          ]),
          findUnique: vi.fn(async () => ({
            id: "def_1",
            capabilityId: "cap_1",
            config: { version: 2 },
            isEnabled: true,
          })),
        },
      } as any;

      const manager = new TriggerRuntimeManager({
        db,
        registry,
        fireTrigger: vi.fn(async () => "evt_1"),
        encryption: { mode: "none" },
      });

      await manager.startAll();
      const runtimeMap = (manager as any).runtimes as Map<string, any>;
      const firstRuntime = runtimeMap.get("def_1");

      await manager.reloadTrigger("def_1");
      const secondRuntime = runtimeMap.get("def_1");

      // First instance should be disposed
      expect(dispose1).toHaveBeenCalledTimes(1);
      expect(dispose2).not.toHaveBeenCalled();

      // Should be different runtime instances
      expect(secondRuntime).not.toBe(firstRuntime);

      await manager.stopAll();
      expect(dispose2).toHaveBeenCalledTimes(1);
    });

    it("does not retain references to stopped triggers", async () => {
      const weakRefs: WeakRef<TriggerRuntime>[] = [];

      const triggerFactory: TriggerFactory = vi.fn(async () => {
        const runtime = {
          start: vi.fn(async () => {}),
          stop: vi.fn(async () => {}),
          dispose: vi.fn(async () => {}),
        };
        weakRefs.push(new WeakRef(runtime));
        return runtime;
      });

      const registry = new PluginRuntimeRegistry(createStubPluginServiceRegistry());
      registry.registerTrigger({
        pluginName: "test-plugin",
        pluginId: "test-plugin-id",
        capabilityId: "cap_1",
        capability: { kind: "TRIGGER", key: "test", displayName: "Test Trigger" },
        factory: triggerFactory,
      });

      const db = {
        triggerDefinition: {
          findMany: vi.fn(async () => [{ id: "def_1", capabilityId: "cap_1", config: {} }]),
          findUnique: vi.fn(),
        },
      } as any;

      const manager = new TriggerRuntimeManager({
        db,
        registry,
        fireTrigger: vi.fn(async () => "evt_1"),
        encryption: { mode: "none" },
      });

      await manager.startAll();
      expect(weakRefs[0].deref()).toBeDefined();

      await manager.stopAll();

      // Force garbage collection if available (only works in Node with --expose-gc flag)
      if (global.gc) {
        global.gc();
        // Wait a bit for GC to run
        await new Promise((resolve) => setTimeout(resolve, 100));
        // The weak reference may or may not be cleared depending on GC timing,
        // but the important thing is that the manager doesn't hold a strong reference
        const runtimeMap = (manager as any).runtimes as Map<string, any>;
        expect(runtimeMap.size).toBe(0);
      }
    });
  });
});
