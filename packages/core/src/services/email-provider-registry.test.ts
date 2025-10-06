import { describe, it, expect, beforeEach } from "vitest";
import { InMemoryEmailProviderRegistry } from "./email-provider-registry.js";
import type { PluginServiceContext } from "./context.js";

function createContext(overrides: Partial<PluginServiceContext> = {}): PluginServiceContext {
  return {
    pluginName: "test-plugin",
    pluginId: "p1",
    capabilityId: "cap-1",
    capabilityKey: "email",
    executionKind: "register",
    timestamp: new Date(),
    ...overrides,
  };
}

describe("InMemoryEmailProviderRegistry", () => {
  let registry: InMemoryEmailProviderRegistry;

  beforeEach(() => {
    registry = new InMemoryEmailProviderRegistry();
  });

  it("registers providers and exposes them as active by default", () => {
    const ctx = createContext();
    registry.register(ctx, {
      id: "provider-1",
      capabilityId: ctx.capabilityId,
      displayName: "Provider One",
      send: async () => {},
    });

    const active = registry.getActiveProvider();
    expect(active?.id).toBe("provider-1");
    expect(active?.pluginName).toBe("test-plugin");
    expect(active?.capabilityId).toBe(ctx.capabilityId);
    expect(registry.listProviders()).toHaveLength(1);
  });

  it("allows registering providers with explicit capability ids", () => {
    const ctx = createContext({ capabilityId: "register-hook" });
    registry.register(ctx, {
      id: "provider-2",
      capabilityId: "cap-other",
      displayName: "Mismatch",
      send: async () => {},
    });

    const stored = registry.getProvider("provider-2");
    expect(stored?.capabilityId).toBe("cap-other");
  });

  it("supports switching the active provider", () => {
    const ctx = createContext();
    registry.register(ctx, {
      id: "provider-1",
      capabilityId: ctx.capabilityId,
      displayName: "Provider One",
      send: async () => {},
    });
    const ctx2 = createContext({ capabilityId: "cap-2" });
    registry.register(ctx2, {
      id: "provider-2",
      capabilityId: ctx2.capabilityId,
      displayName: "Provider Two",
      send: async () => {},
    });

    registry.setActiveProvider(ctx, "provider-2");
    expect(registry.getActiveProvider()?.id).toBe("provider-2");
  });

  it("throws when setting an unknown provider active", () => {
    expect(() => registry.setActiveProvider(createContext(), "missing")).toThrow(/Unknown/);
  });

  it("unregisters providers and clears the active selection", () => {
    const ctx = createContext();
    registry.register(ctx, {
      id: "provider-1",
      capabilityId: ctx.capabilityId,
      displayName: "Provider One",
      send: async () => {},
    });

    registry.unregister(ctx, "provider-1");
    expect(registry.getActiveProvider()).toBeUndefined();
    expect(registry.listProviders()).toHaveLength(0);
  });

  it("prevents unregistering a provider from another plugin", () => {
    const ctx = createContext();
    registry.register(ctx, {
      id: "provider-1",
      capabilityId: ctx.capabilityId,
      displayName: "Provider One",
      send: async () => {},
    });

    expect(() =>
      registry.unregister(
        createContext({ pluginName: "other", capabilityId: ctx.capabilityId }),
        "provider-1",
      ),
    ).toThrow(/owning plugin/);
  });
});
