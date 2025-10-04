import { describe, it, expect, vi } from "vitest";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";

import {
  loadPlugins,
  PluginRuntimeRegistry,
  upsertPluginsIntoDb,
  type LoadedPlugin,
} from "../plugins/plugin-loader.js";
import type { ProviderDescriptor } from "./contracts.js";
import type { DbClient } from "../db/db.js";
import { createStubPluginServiceRegistry } from "../services/stubs.js";

class MockSystemConfigService {
  private store = new Map<string, { value: unknown; schema?: unknown }>();

  async get(key: string) {
    const entry = this.store.get(key);
    if (!entry) return null;
    return {
      key,
      value: entry.value,
      category: null,
      schema: entry.schema ?? null,
      metadata: null,
      isSecret: true,
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
      createdBy: null,
      updatedBy: null,
      source: "database" as const,
    };
  }

  async set(key: string, value: unknown, options: { schema?: unknown } = {}) {
    this.store.set(key, { value, schema: options.schema });
    return (await this.get(key))!;
  }

  getStoredValue(key: string) {
    return this.store.get(key)?.value;
  }

  async validateSchema(
    _key: string,
    value: unknown,
    schemaOverride?: unknown,
  ): Promise<{ valid: boolean; errors?: string[] }> {
    const schema = schemaOverride as Record<string, unknown> | undefined;
    if (!schema) return { valid: true };
    if (schema.type === "object") {
      if (typeof value !== "object" || value === null || Array.isArray(value)) {
        return { valid: false, errors: ["Expected object"] };
      }
      if (Array.isArray(schema.required)) {
        const missing = schema.required.filter(
          (key) => (value as Record<string, unknown>)[key] == null,
        );
        if (missing.length > 0) {
          return { valid: false, errors: missing.map((k) => `Missing required property ${k}`) };
        }
      }
    }
    return { valid: true };
  }
}

describe("plugin-loader", () => {
  it("loads capabilities from a plugin directory", async () => {
    const base = await fs.promises.mkdtemp(path.join(os.tmpdir(), "lf-plugins-"));
    try {
      const tmpDir = path.join(base, "fake");
      await fs.promises.mkdir(tmpDir, { recursive: true });
      const modContent = [
        "module.exports = {",
        "  capabilities: [",
        "    { kind: 'TRIGGER', key: 'cron_schedule', displayName: 'Cron Schedule' }",
        "  ],",
        "  triggers: {",
        "    cron_schedule: () => ({",
        "      start: async () => {},",
        "      stop: async () => {},",
        "    })",
        "  }",
        "};",
      ].join("\n");
      await fs.promises.writeFile(path.join(tmpDir, "index.js"), modContent, "utf8");

      const plugins = await loadPlugins(base);
      expect(plugins.length).toBeGreaterThan(0);
      expect(plugins[0].capabilities[0]).toMatchObject({ key: "cron_schedule", kind: "TRIGGER" });
    } finally {
      await fs.promises.rm(base, { recursive: true, force: true });
    }
  });
});

function createFakeDb() {
  type PluginRow = { id: string; name: string };
  type CapRow = {
    id: string;
    pluginId: string;
    kind: "TRIGGER" | "ACTION";
    key: string;
    displayName: string;
    jsonSchema?: unknown | null;
    isEnabled: boolean;
  };
  const plugins = new Map<string, PluginRow>();
  const caps = new Map<string, CapRow>();
  const store = {
    plugin: {
      findFirst: vi.fn(
        async ({ where: { name } }: { where: { name: string } }) => plugins.get(name) ?? null,
      ),
      create: vi.fn(async ({ data: { name } }: { data: { name: string } }) => {
        const obj: PluginRow = { id: `p_${name}`, name };
        plugins.set(name, obj);
        return obj;
      }),
      update: vi.fn(async ({ where: { id } }: { where: { id: string } }) => {
        return Array.from(plugins.values()).find((p) => p.id === id) ?? null;
      }),
    },
    pluginCapability: {
      upsert: vi.fn(
        async ({
          where: { pluginId_key },
          create,
          update,
        }: {
          where: { pluginId_key: { pluginId: string; key: string } };
          create: {
            pluginId: string;
            kind: "TRIGGER" | "ACTION";
            key: string;
            displayName: string;
            jsonSchema?: unknown | null;
          };
          update: {
            displayName?: string;
            jsonSchema?: unknown | null;
            isEnabled?: boolean;
          };
        }) => {
          const k = `${pluginId_key.pluginId}:${create.key}`;
          const existing = caps.get(k);
          if (!existing) {
            const row: CapRow = {
              id: `c_${k}`,
              pluginId: create.pluginId,
              kind: create.kind,
              key: create.key,
              displayName: create.displayName,
              jsonSchema: create.jsonSchema ?? null,
              isEnabled: true,
            };
            caps.set(k, row);
            return row;
          }

          if (update.displayName !== undefined) existing.displayName = update.displayName;
          if (update.jsonSchema !== undefined) existing.jsonSchema = update.jsonSchema;
          if (update.isEnabled !== undefined) existing.isEnabled = update.isEnabled;
          return existing;
        },
      ),
    },
    __caps: caps,
  };
  return store as unknown as DbClient & { __caps: Map<string, CapRow> };
}

describe("plugin upsert", () => {
  it("inserts plugin and capabilities and registers runtime", async () => {
    const triggerFactory = vi.fn(() => ({
      start: async () => {},
      stop: async () => {},
    }));
    const actionFactory = vi.fn(() => ({
      execute: async () => ({}),
    }));
    const plugins: LoadedPlugin[] = [
      {
        name: "fake",
        capabilities: [
          { kind: "TRIGGER", key: "cron", displayName: "Cron" },
          { kind: "ACTION", key: "email", displayName: "Email" },
        ],
        module: {
          capabilities: [
            { kind: "TRIGGER", key: "cron", displayName: "Cron" },
            { kind: "ACTION", key: "email", displayName: "Email" },
          ],
          triggers: { cron: triggerFactory },
          actions: { email: actionFactory },
        },
      },
    ];
    const db = createFakeDb();
    const runtime = new PluginRuntimeRegistry(createStubPluginServiceRegistry());
    const systemConfig = new MockSystemConfigService();
    await upsertPluginsIntoDb(db, plugins, runtime, { systemConfig });
    expect(runtime.getTriggerById("c_p_fake:cron")).toBeTruthy();
    expect(runtime.getTriggerByKey("fake", "cron")).toBeTruthy();
    expect(runtime.requireTriggerById("c_p_fake:cron")).toBeTruthy();
    expect(() => runtime.requireTriggerById("missing")).toThrow();

    expect(runtime.getActionById("c_p_fake:email")).toBeTruthy();
    expect(runtime.getActionByKey("fake", "email")).toBeTruthy();
    expect(runtime.requireActionById("c_p_fake:email")).toBeTruthy();
    expect(() => runtime.requireActionByKey("fake", "other")).toThrow();
    expect(triggerFactory).toHaveBeenCalledTimes(0);
    expect(actionFactory).toHaveBeenCalledTimes(0);
  });

  it("invokes plugin register hook with runtime services", async () => {
    const register = vi.fn();
    const triggerFactory = vi.fn(() => ({
      start: async () => {},
      stop: async () => {},
    }));
    const plugins: LoadedPlugin[] = [
      {
        name: "fake",
        capabilities: [{ kind: "TRIGGER", key: "cron", displayName: "Cron" }],
        module: {
          capabilities: [{ kind: "TRIGGER", key: "cron", displayName: "Cron" }],
          triggers: { cron: triggerFactory },
          register,
        },
      },
    ];
    const db = createFakeDb();
    const serviceRegistry = createStubPluginServiceRegistry();
    const runtime = new PluginRuntimeRegistry(serviceRegistry);
    const systemConfig = new MockSystemConfigService();
    await upsertPluginsIntoDb(db, plugins, runtime, { systemConfig });
    expect(register).toHaveBeenCalledTimes(1);
    const args = register.mock.calls[0][0];
    expect(args.plugin).toEqual({ name: "fake" });
    expect(args.services.logger).toBeDefined();
    const rawCore = serviceRegistry.getAllServices();
    expect(args.services.core).not.toBe(rawCore);
    expect(Object.keys(args.services.core)).toEqual(Object.keys(rawCore));
    expect(args.services.core.bundles).not.toBe(rawCore.bundles);
  });

  it("registers provider descriptors and injects validated config", async () => {
    const sendHandler = vi.fn();
    const providerDescriptor = {
      kind: "email" as const,
      id: "gmail",
      displayName: "Gmail",
      configSchema: {
        type: "object",
        properties: {
          providerId: { type: "string" },
          displayName: { type: "string" },
          clientId: { type: "string" },
          clientSecret: { type: "string" },
          refreshToken: { type: "string" },
          sender: { type: "string" },
          makeDefault: { type: "boolean" },
        },
        required: ["providerId", "clientId", "clientSecret", "refreshToken", "sender"],
        additionalProperties: false,
      },
      defaults: {
        providerId: "gmail",
        displayName: "Gmail",
        clientId: "client-id",
        clientSecret: "client-secret",
        refreshToken: "refresh-token",
        sender: "sender@example.com",
        makeDefault: true,
      },
      async register({ services, config }) {
        await services.core.emailProviders.register(
          { requestedScopes: ["email:send"] },
          {
            id: config.providerId,
            capabilityId: "gmail:email",
            displayName: config.displayName,
            send: sendHandler,
          },
        );
        if (config.makeDefault) {
          await services.core.emailProviders.setActiveProvider(
            { requestedScopes: ["email:send"] },
            config.providerId,
          );
        }
      },
    } satisfies ProviderDescriptor<Record<string, unknown>>;

    const plugins: LoadedPlugin[] = [
      {
        name: "gmail",
        capabilities: [],
        module: {
          capabilities: [],
          providers: [providerDescriptor],
        },
      },
    ];

    const db = createFakeDb();
    const serviceRegistry = createStubPluginServiceRegistry();
    const runtime = new PluginRuntimeRegistry(serviceRegistry);
    const systemConfig = new MockSystemConfigService();

    const emailService = serviceRegistry.get("emailProviders");
    const registerSpy = vi.spyOn(emailService, "register");
    const setActiveSpy = vi.spyOn(emailService, "setActiveProvider");

    await upsertPluginsIntoDb(db, plugins, runtime, { systemConfig });

    expect(registerSpy).toHaveBeenCalledTimes(1);
    expect(setActiveSpy).toHaveBeenCalledWith(
      expect.objectContaining({ requestedScopes: ["email:send"] }),
      "gmail",
    );
    expect(systemConfig.getStoredValue("PLUGIN_GMAIL_PROVIDER_GMAIL")).toEqual(
      expect.objectContaining({ providerId: "gmail" }),
    );
  });

  it("throws when trigger capability handler is missing", async () => {
    const plugins: LoadedPlugin[] = [
      {
        name: "bad",
        capabilities: [{ kind: "TRIGGER", key: "cron", displayName: "Cron" }],
        module: {
          capabilities: [{ kind: "TRIGGER", key: "cron", displayName: "Cron" }],
          triggers: {},
        },
      },
    ];
    const db = createFakeDb();
    const runtime = new PluginRuntimeRegistry(createStubPluginServiceRegistry());
    const systemConfig = new MockSystemConfigService();
    await expect(upsertPluginsIntoDb(db, plugins, runtime, { systemConfig })).rejects.toThrow(
      /has no exported handler/,
    );
  });

  it("throws when action capability handler is missing", async () => {
    const plugins: LoadedPlugin[] = [
      {
        name: "bad",
        capabilities: [{ kind: "ACTION", key: "notify", displayName: "Notify" }],
        module: {
          capabilities: [{ kind: "ACTION", key: "notify", displayName: "Notify" }],
          actions: {},
        },
      },
    ];
    const db = createFakeDb();
    const runtime = new PluginRuntimeRegistry(createStubPluginServiceRegistry());
    const systemConfig = new MockSystemConfigService();
    await expect(upsertPluginsIntoDb(db, plugins, runtime, { systemConfig })).rejects.toThrow(
      /has no exported handler/,
    );
  });

  it("removes plugin and disposes module", async () => {
    const dispose = vi.fn();
    const plugins: LoadedPlugin[] = [
      {
        name: "fake",
        capabilities: [
          { kind: "TRIGGER", key: "cron", displayName: "Cron" },
          { kind: "ACTION", key: "email", displayName: "Email" },
        ],
        module: {
          capabilities: [
            { kind: "TRIGGER", key: "cron", displayName: "Cron" },
            { kind: "ACTION", key: "email", displayName: "Email" },
          ],
          triggers: { cron: () => ({ start: async () => {}, stop: async () => {} }) },
          actions: { email: () => ({ execute: async () => ({}) }) },
          dispose,
        },
      },
    ];
    const db = createFakeDb();
    const runtime = new PluginRuntimeRegistry(createStubPluginServiceRegistry());
    await upsertPluginsIntoDb(db, plugins, runtime, {
      systemConfig: new MockSystemConfigService(),
    });
    expect(runtime.getTriggerById("c_p_fake:cron")).toBeTruthy();
    await runtime.removePlugin("fake");
    expect(runtime.getTriggerById("c_p_fake:cron")).toBeUndefined();
    expect(runtime.getActionById("c_p_fake:email")).toBeUndefined();
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it("reactivates capabilities on repeated boots", async () => {
    const plugins: LoadedPlugin[] = [
      {
        name: "fake",
        capabilities: [{ kind: "ACTION", key: "email", displayName: "Email" }],
        module: {
          capabilities: [{ kind: "ACTION", key: "email", displayName: "Email" }],
          actions: { email: () => ({ execute: async () => ({}) }) },
        },
      },
    ];
    const db = createFakeDb();
    const runtime = new PluginRuntimeRegistry(createStubPluginServiceRegistry());
    await upsertPluginsIntoDb(db, plugins, runtime, {
      systemConfig: new MockSystemConfigService(),
    });

    const helper = db as unknown as { __caps: Map<string, { isEnabled: boolean }> };
    for (const row of helper.__caps.values()) {
      row.isEnabled = false;
    }

    await upsertPluginsIntoDb(db, plugins, runtime, {
      systemConfig: new MockSystemConfigService(),
    });
    const ref = runtime.requireActionById("c_p_fake:email");
    expect(ref).toBeTruthy();
    for (const row of helper.__caps.values()) {
      expect(row.isEnabled).toBe(true);
    }
  });
});
