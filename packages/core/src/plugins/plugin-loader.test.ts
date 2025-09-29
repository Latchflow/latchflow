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
  };
  const plugins = new Map<string, PluginRow>();
  const caps = new Map<string, CapRow>();
  return {
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
        }: {
          where: { pluginId_key: { pluginId: string; key: string } };
          create: {
            pluginId: string;
            kind: "TRIGGER" | "ACTION";
            key: string;
            displayName: string;
            jsonSchema?: unknown | null;
          };
        }) => {
          const k = `${pluginId_key.pluginId}:${create.key}`;
          const row: CapRow = {
            id: `c_${k}`,
            pluginId: create.pluginId,
            kind: create.kind,
            key: create.key,
            displayName: create.displayName,
            jsonSchema: create.jsonSchema ?? null,
          };
          caps.set(k, row);
          return row;
        },
      ),
    },
  } as unknown as DbClient;
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
    expect(runtime.getActionById("c_p_fake:email")).toBeTruthy();
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
    expect(args.services.core).toBe(serviceRegistry.getAllServices());
  });
});
