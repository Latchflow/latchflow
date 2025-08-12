import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { DbClient } from "../db.js";

export const CapabilitySchema = z.object({
  kind: z.enum(["TRIGGER", "ACTION"]),
  key: z.string().min(1),
  displayName: z.string().min(1),
  // Arbitrary JSON schema object for plugin-specific config. Stored as-is.
  configSchema: z.unknown().optional(),
});

export type Capability = z.infer<typeof CapabilitySchema>;

export type LoadedPlugin = {
  name: string;
  capabilities: Capability[];
  // Keep the runtime refs if needed later
  module: unknown;
};

export async function loadPlugins(pluginsPath: string): Promise<LoadedPlugin[]> {
  const abs = path.resolve(process.cwd(), pluginsPath);
  if (!fs.existsSync(abs)) return [];
  const entries = await fs.promises.readdir(abs, { withFileTypes: true });
  const plugins: LoadedPlugin[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const modPath = path.join(abs, entry.name);
    try {
      const mod: unknown = await import(modPath);
      const modObj = mod as Record<string, unknown>;
      const capsUnknown = (modObj.capabilities ??
        (modObj.default as Record<string, unknown> | undefined)?.capabilities) as unknown;
      const parsed = z.array(CapabilitySchema).safeParse(capsUnknown);
      if (!parsed.success) continue;
      plugins.push({ name: entry.name, capabilities: parsed.data, module: mod });
    } catch {
      // skip invalid plugin dirs
    }
  }
  return plugins;
}

export type RuntimeCapabilityRef = {
  kind: "TRIGGER" | "ACTION";
  key: string;
  displayName: string;
  // The module that provided this capability; actual handlers are plugin-defined
  module: unknown;
};

export class PluginRuntimeRegistry {
  private byKey = new Map<string, RuntimeCapabilityRef>();
  add(ref: RuntimeCapabilityRef) {
    this.byKey.set(`${ref.kind}:${ref.key}`, ref);
  }
  get(kind: "TRIGGER" | "ACTION", key: string): RuntimeCapabilityRef | undefined {
    return this.byKey.get(`${kind}:${key}`);
  }
}

export async function upsertPluginsIntoDb(
  db: DbClient,
  plugins: LoadedPlugin[],
  runtime: PluginRuntimeRegistry,
) {
  for (const p of plugins) {
    // Find or create Plugin by name
    const existing = await db.plugin.findFirst({ where: { name: p.name } });
    const plugin = existing
      ? await db.plugin.update({ where: { id: existing.id }, data: {} })
      : await db.plugin.create({ data: { name: p.name } });

    for (const cap of p.capabilities) {
      // Upsert capability by composite unique (pluginId, key)
      // Prisma generates a compound unique input alias 'pluginId_key'
      await db.pluginCapability.upsert({
        where: { pluginId_key: { pluginId: plugin.id, key: cap.key } },
        create: {
          pluginId: plugin.id,
          kind: cap.kind,
          key: cap.key,
          displayName: cap.displayName,
          jsonSchema: (cap.configSchema ?? null) as unknown,
        },
        update: {
          displayName: cap.displayName,
          jsonSchema: (cap.configSchema ?? null) as unknown,
          isEnabled: true,
        },
      });

      runtime.add({ kind: cap.kind, key: cap.key, displayName: cap.displayName, module: p.module });
    }
  }
}
