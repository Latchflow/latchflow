import fs from "node:fs";
import path from "node:path";
import type { DbClient } from "../db/db.js";
import type { Prisma } from "@latchflow/db";
import {
  CapabilityArraySchema,
  type Capability,
  type PluginModule,
  type TriggerFactory,
  type ActionFactory,
  type TriggerCapability,
  type ActionCapability,
  isTriggerCapability,
  isActionCapability,
  isPluginModule,
} from "./contracts.js";
import { createPluginLogger } from "../observability/logger.js";

export type LoadedPlugin = {
  name: string;
  module: PluginModule;
  capabilities: Capability[];
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
      const pluginModule = resolvePluginModule(mod);
      if (!pluginModule) continue;
      const parsed = CapabilityArraySchema.safeParse(pluginModule.capabilities ?? []);
      if (!parsed.success) continue;
      const normalized: PluginModule = {
        ...pluginModule,
        capabilities: parsed.data,
      };
      plugins.push({ name: entry.name, module: normalized, capabilities: normalized.capabilities });
    } catch {
      // skip invalid plugin dirs
    }
  }
  return plugins;
}

export class PluginRuntimeRegistry {
  private triggers = new Map<string, TriggerRuntimeRef>();
  private actions = new Map<string, ActionRuntimeRef>();

  registerTrigger(ref: TriggerRuntimeRef) {
    this.triggers.set(ref.capabilityId, ref);
  }

  registerAction(ref: ActionRuntimeRef) {
    this.actions.set(ref.capabilityId, ref);
  }

  getTriggerById(capabilityId: string): TriggerRuntimeRef | undefined {
    return this.triggers.get(capabilityId);
  }

  getActionById(capabilityId: string): ActionRuntimeRef | undefined {
    return this.actions.get(capabilityId);
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
    const pluginRow = existing ?? (await db.plugin.create({ data: { name: p.name } }));

    for (const cap of p.capabilities) {
      // Upsert capability by composite unique (pluginId, key)
      // Prisma generates a compound unique input alias 'pluginId_key'
      const capabilityRow = await db.pluginCapability.upsert({
        where: { pluginId_key: { pluginId: pluginRow.id, key: cap.key } },
        create: {
          pluginId: pluginRow.id,
          kind: cap.kind,
          key: cap.key,
          displayName: cap.displayName,
          // Store plugin-provided config schema JSON as-is
          jsonSchema: (cap.configSchema ?? null) as unknown as
            | Prisma.InputJsonValue
            | Prisma.NullableJsonNullValueInput,
        },
        update: {
          displayName: cap.displayName,
          jsonSchema: (cap.configSchema ?? null) as unknown as
            | Prisma.InputJsonValue
            | Prisma.NullableJsonNullValueInput,
          isEnabled: true,
        },
      });

      if (isTriggerCapability(cap)) {
        const factory = resolveTriggerFactory(p.module, cap.key);
        if (!factory) {
          createPluginLogger(p.name).warn(
            { capabilityKey: cap.key },
            "Trigger capability registered without runtime factory",
          );
          continue;
        }
        runtime.registerTrigger({
          pluginName: p.name,
          capability: { ...cap },
          capabilityId: capabilityRow.id,
          factory,
        });
      } else if (isActionCapability(cap)) {
        const factory = resolveActionFactory(p.module, cap.key);
        if (!factory) {
          createPluginLogger(p.name).warn(
            { capabilityKey: cap.key },
            "Action capability registered without runtime factory",
          );
          continue;
        }
        runtime.registerAction({
          pluginName: p.name,
          capability: { ...cap },
          capabilityId: capabilityRow.id,
          factory,
        });
      }
    }
  }
}

export type TriggerRuntimeRef = {
  pluginName: string;
  capabilityId: string;
  capability: TriggerCapability;
  factory: TriggerFactory;
};

export type ActionRuntimeRef = {
  pluginName: string;
  capabilityId: string;
  capability: ActionCapability;
  factory: ActionFactory;
};

function resolvePluginModule(mod: unknown): PluginModule | null {
  if (!mod) return null;
  if (isPluginModule(mod)) return mod;
  if (typeof mod === "object") {
    const obj = mod as Record<string, unknown>;
    if (isPluginModule(obj.plugin)) return obj.plugin;
    if (isPluginModule(obj.default)) return obj.default as PluginModule;
  }
  return null;
}

function resolveTriggerFactory(module: PluginModule, key: string): TriggerFactory | null {
  if (!module.triggers) return null;
  const candidate = module.triggers[key];
  return typeof candidate === "function" ? candidate : null;
}

function resolveActionFactory(module: PluginModule, key: string): ActionFactory | null {
  if (!module.actions) return null;
  const candidate = module.actions[key];
  return typeof candidate === "function" ? candidate : null;
}
