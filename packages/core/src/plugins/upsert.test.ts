import { describe, it, expect, vi } from "vitest";
import {
  PluginRuntimeRegistry,
  upsertPluginsIntoDb,
  type LoadedPlugin,
} from "../plugins/plugin-loader";
import type { DbClient } from "../db/db.js";

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
    const plugins: LoadedPlugin[] = [
      {
        name: "fake",
        capabilities: [
          { kind: "TRIGGER", key: "cron", displayName: "Cron" },
          { kind: "ACTION", key: "email", displayName: "Email" },
        ],
        module: {},
      },
    ];
    const db = createFakeDb();
    const runtime = new PluginRuntimeRegistry();
    await upsertPluginsIntoDb(db, plugins, runtime);
    expect(runtime.get("TRIGGER", "cron")).toBeTruthy();
    expect(runtime.get("ACTION", "email")).toBeTruthy();
  });
});
