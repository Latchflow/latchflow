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
import type { DbClient } from "../db/db.js";
import { createStubPluginServiceRegistry } from "../services/stubs.js";

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
    await upsertPluginsIntoDb(db, plugins, runtime);
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
    await upsertPluginsIntoDb(db, plugins, runtime);
    expect(register).toHaveBeenCalledTimes(1);
    const args = register.mock.calls[0][0];
    expect(args.plugin).toEqual({ name: "fake" });
    expect(args.services.logger).toBeDefined();
    const rawCore = serviceRegistry.getAllServices();
    expect(args.services.core).not.toBe(rawCore);
    expect(Object.keys(args.services.core)).toEqual(Object.keys(rawCore));
    expect(args.services.core.bundles).not.toBe(rawCore.bundles);
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
    await expect(upsertPluginsIntoDb(db, plugins, runtime)).rejects.toThrow(
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
    await expect(upsertPluginsIntoDb(db, plugins, runtime)).rejects.toThrow(
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
    await upsertPluginsIntoDb(db, plugins, runtime);
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
    await upsertPluginsIntoDb(db, plugins, runtime);

    const helper = db as unknown as { __caps: Map<string, { isEnabled: boolean }> };
    for (const row of helper.__caps.values()) {
      row.isEnabled = false;
    }

    await upsertPluginsIntoDb(db, plugins, runtime);
    const ref = runtime.requireActionById("c_p_fake:email");
    expect(ref).toBeTruthy();
    for (const row of helper.__caps.values()) {
      expect(row.isEnabled).toBe(true);
    }
  });
});
