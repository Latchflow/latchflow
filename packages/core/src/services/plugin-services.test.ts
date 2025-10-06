import { describe, it, expect, beforeEach, vi } from "vitest";

const recordPluginServiceCallMock = vi.hoisted(() => vi.fn(() => Promise.resolve()));

vi.mock("../audit/plugin-service-call.js", () => ({
  recordPluginServiceCall: recordPluginServiceCallMock,
}));

import { PluginServiceRegistry, type PluginServiceRuntimeContextInit } from "./plugin-services.js";
import { PLUGIN_SERVICE_SCOPES } from "./scopes.js";
import type { PluginServiceCallContext } from "./context.js";
import { PluginServiceError } from "./errors.js";
import type { BundleControlService } from "./resource-control-service.js";
import type { EmailProviderRegistry } from "./email-provider-registry.js";

describe("PluginServiceRegistry instrumentation", () => {
  beforeEach(() => {
    recordPluginServiceCallMock.mockClear();
  });

  it("merges base context, preserves metadata, and logs success", async () => {
    const captured: PluginServiceCallContext[] = [];

    const bundlesService: BundleControlService = {
      setEnabled: vi.fn(async (ctx, _bundleId, _isEnabled) => {
        captured.push(ctx as PluginServiceCallContext);
      }),
    };

    const registry = createRegistry({ bundles: bundlesService });

    const baseContext: PluginServiceRuntimeContextInit = {
      pluginName: "plugin-alpha",
      pluginId: "plugin-1",
      capabilityId: "cap-1",
      capabilityKey: "bundle-toggle",
      executionKind: "action",
      definitionId: "def-1",
      invocationId: "inv-1",
      triggerEventId: "event-1",
      manualInvokerId: "user-1",
    };

    const services = registry.createScopedServices(baseContext);
    const requestedAt = new Date();
    const pluginContext: PluginServiceCallContext = {
      pluginName: "override",
      pluginId: "override",
      capabilityId: "override",
      capabilityKey: "override",
      executionKind: "trigger",
      correlationId: "corr-123",
      timestamp: requestedAt,
      requestedScopes: ["custom:read"],
    };

    await services.bundles.setEnabled(pluginContext, "bundle-7", true);

    expect(bundlesService.setEnabled).toHaveBeenCalledTimes(1);
    expect(captured).toHaveLength(1);
    const ctx = captured[0];

    expect(ctx.pluginName).toBe("plugin-alpha");
    expect(ctx.pluginId).toBe("plugin-1");
    expect(ctx.capabilityId).toBe("cap-1");
    expect(ctx.capabilityKey).toBe("bundle-toggle");
    expect(ctx.executionKind).toBe("action");
    expect(ctx.definitionId).toBe("def-1");
    expect(ctx.invocationId).toBe("inv-1");
    expect(ctx.triggerEventId).toBe("event-1");
    expect(ctx.manualInvokerId).toBe("user-1");
    expect(ctx.correlationId).toBe("corr-123");
    expect(Array.isArray(ctx.requestedScopes)).toBe(true);
    expect(ctx.requestedScopes).toEqual(["custom:read"]);
    expect(ctx.grantedScopes).toEqual([PLUGIN_SERVICE_SCOPES.BUNDLES_WRITE]);
    expect(ctx.deniedScopes).toEqual(["custom:read"]);
    expect(ctx.timestamp).toBeInstanceOf(Date);
    expect(ctx.timestamp).not.toBe(requestedAt);

    expect(recordPluginServiceCallMock).toHaveBeenCalledTimes(1);
    const auditEntry = recordPluginServiceCallMock.mock.calls[0][0];
    expect(auditEntry).toMatchObject({
      pluginName: "plugin-alpha",
      pluginId: "plugin-1",
      capabilityId: "cap-1",
      capabilityKey: "bundle-toggle",
      executionKind: "action",
      definitionId: "def-1",
      invocationId: "inv-1",
      triggerEventId: "event-1",
      manualInvokerId: "user-1",
      serviceKey: "bundles",
      method: "setEnabled",
      outcome: "SUCCEEDED",
    });
    expect(auditEntry.requestedScopes).toEqual(["custom:read"]);
    expect(auditEntry.grantedScopes).toEqual([PLUGIN_SERVICE_SCOPES.BUNDLES_WRITE]);
    expect(auditEntry.deniedScopes).toEqual(["custom:read"]);
  });

  it("logs failures with plugin service error metadata", async () => {
    const error = PluginServiceError.permission("NO_ACCESS");
    const bundlesService: BundleControlService = {
      setEnabled: vi.fn(async () => {
        throw error;
      }),
    };

    const registry = createRegistry({ bundles: bundlesService });
    const baseContext: PluginServiceRuntimeContextInit = {
      pluginName: "plugin-beta",
      pluginId: "plugin-2",
      capabilityId: "cap-9",
      capabilityKey: "bundle-toggle",
      executionKind: "action",
      definitionId: "def-9",
      invocationId: "inv-22",
    };

    const services = registry.createScopedServices(baseContext);
    const pluginContext: PluginServiceCallContext = {
      pluginName: "override",
      capabilityId: "override",
      capabilityKey: "override",
      executionKind: "trigger",
      timestamp: new Date(),
    };

    await expect(services.bundles.setEnabled(pluginContext, "bundle-3", false)).rejects.toThrow(
      error,
    );

    expect(recordPluginServiceCallMock).toHaveBeenCalledTimes(1);
    const auditEntry = recordPluginServiceCallMock.mock.calls[0][0];
    expect(auditEntry.outcome).toBe("FAILED");
    expect(auditEntry.errorKind).toBe("PERMISSION");
    expect(auditEntry.errorMessage).toBe(error.message);
    expect(auditEntry.pluginName).toBe("plugin-beta");
    expect(auditEntry.capabilityId).toBe("cap-9");
  });

  it("throws fatal error when context is missing", async () => {
    const bundlesService: BundleControlService = {
      setEnabled: vi.fn(async () => {}),
    };

    const registry = createRegistry({ bundles: bundlesService });
    const services = registry.createScopedServices({
      pluginName: "plugin-gamma",
      pluginId: "plug-3",
      capabilityId: "cap-ctx",
      capabilityKey: "bundles",
      executionKind: "action",
    });

    expect(() =>
      (services.bundles as BundleControlService).setEnabled(undefined as any, "bundle", true),
    ).toThrow(/requires a context/);

    expect(bundlesService.setEnabled).not.toHaveBeenCalled();
    expect(recordPluginServiceCallMock).not.toHaveBeenCalled();
  });
});

interface RegistryOverrides {
  bundles?: BundleControlService;
}

function createRegistry(overrides: RegistryOverrides) {
  const noopToggle: BundleControlService = {
    setEnabled: vi.fn(async () => {}),
  };

  const emailRegistry: EmailProviderRegistry = {
    register: vi.fn(),
    unregister: vi.fn(),
    getProvider: vi.fn(() => undefined),
    getActiveProvider: vi.fn(() => undefined),
    setActiveProvider: vi.fn(),
    listProviders: vi.fn(() => []),
  };

  const userService = {
    assignRole: vi.fn(async () => {}),
    setActive: vi.fn(async () => {}),
    revokeSessions: vi.fn(async () => 0),
  };

  const storageService = {
    createReleaseLink: vi.fn(async () => ({ url: "https://example.com" })),
    getBundleObjectHead: vi.fn(async () => null),
  };

  return new PluginServiceRegistry({
    emailProviders: {
      service: emailRegistry,
      scopes: [PLUGIN_SERVICE_SCOPES.EMAIL_SEND],
    },
    users: {
      service: userService,
      scopes: [PLUGIN_SERVICE_SCOPES.USERS_WRITE],
    },
    bundles: {
      service: overrides.bundles ?? noopToggle,
      scopes: [PLUGIN_SERVICE_SCOPES.BUNDLES_WRITE],
    },
    bundleAssignments: {
      service: noopToggle,
      scopes: [PLUGIN_SERVICE_SCOPES.BUNDLE_ASSIGNMENTS_WRITE],
    },
    recipients: {
      service: noopToggle,
      scopes: [PLUGIN_SERVICE_SCOPES.RECIPIENTS_WRITE],
    },
    actions: {
      service: noopToggle,
      scopes: [PLUGIN_SERVICE_SCOPES.ACTIONS_WRITE],
    },
    triggers: {
      service: noopToggle,
      scopes: [PLUGIN_SERVICE_SCOPES.TRIGGERS_WRITE],
    },
    pipelines: {
      service: noopToggle,
      scopes: [PLUGIN_SERVICE_SCOPES.PIPELINES_WRITE],
    },
    storage: {
      service: storageService,
      scopes: [PLUGIN_SERVICE_SCOPES.STORAGE_LINK],
    },
  });
}
