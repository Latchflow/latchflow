import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
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
  type PluginRuntimeServices,
  isTriggerCapability,
  isActionCapability,
  isPluginModule,
} from "./contracts.js";
import { createPluginLogger } from "../observability/logger.js";
import { PluginServiceRegistry } from "../services/plugin-services.js";

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
    const plugin = await loadPluginByName(pluginsPath, entry.name);
    if (plugin) plugins.push(plugin);
  }
  return plugins;
}

export async function loadPluginByName(
  pluginsPath: string,
  pluginName: string,
  options?: { cacheBust?: boolean },
): Promise<LoadedPlugin | null> {
  const abs = path.resolve(process.cwd(), pluginsPath, pluginName);
  try {
    const stats = await fs.promises.stat(abs);
    if (!stats.isDirectory()) return null;
  } catch {
    return null;
  }

  const mod = await importPlugin(abs, options?.cacheBust === true);
  if (!mod) return null;
  const pluginModule = resolvePluginModule(mod);
  if (!pluginModule) return null;
  return normalizePlugin(pluginName, pluginModule);
}

const capabilityKey = (pluginName: string, capKey: string) => `${pluginName}:${capKey}`;

export class PluginRuntimeRegistry {
  private triggers = new Map<string, TriggerRuntimeRef>();
  private triggerByKey = new Map<string, TriggerRuntimeRef>();
  private actions = new Map<string, ActionRuntimeRef>();
  private actionByKey = new Map<string, ActionRuntimeRef>();
  private pluginTrigIds = new Map<string, Set<string>>();
  private pluginActIds = new Map<string, Set<string>>();
  private pluginModules = new Map<string, PluginModule>();

  constructor(private readonly services: PluginServiceRegistry) {}

  registerTrigger(ref: TriggerRuntimeRef) {
    if (this.triggers.has(ref.capabilityId)) {
      throw new Error(`Trigger capability already registered: ${ref.capabilityId}`);
    }
    const key = capabilityKey(ref.pluginName, ref.capability.key);
    if (this.triggerByKey.has(key)) {
      throw new Error(`Trigger capability already registered: ${key}`);
    }
    this.triggers.set(ref.capabilityId, ref);
    this.triggerByKey.set(key, ref);
    if (!this.pluginTrigIds.has(ref.pluginName)) {
      this.pluginTrigIds.set(ref.pluginName, new Set());
    }
    this.pluginTrigIds.get(ref.pluginName)!.add(ref.capabilityId);
  }

  registerAction(ref: ActionRuntimeRef) {
    if (this.actions.has(ref.capabilityId)) {
      throw new Error(`Action capability already registered: ${ref.capabilityId}`);
    }
    const key = capabilityKey(ref.pluginName, ref.capability.key);
    if (this.actionByKey.has(key)) {
      throw new Error(`Action capability already registered: ${key}`);
    }
    this.actions.set(ref.capabilityId, ref);
    this.actionByKey.set(key, ref);
    if (!this.pluginActIds.has(ref.pluginName)) {
      this.pluginActIds.set(ref.pluginName, new Set());
    }
    this.pluginActIds.get(ref.pluginName)!.add(ref.capabilityId);
  }

  getTriggerById(capabilityId: string): TriggerRuntimeRef | undefined {
    return this.triggers.get(capabilityId);
  }

  getTriggerByKey(pluginName: string, key: string): TriggerRuntimeRef | undefined {
    return this.triggerByKey.get(capabilityKey(pluginName, key));
  }

  requireTriggerById(capabilityId: string): TriggerRuntimeRef {
    const ref = this.getTriggerById(capabilityId);
    if (!ref) {
      throw new Error(`Trigger capability not registered: ${capabilityId}`);
    }
    return ref;
  }

  requireTriggerByKey(pluginName: string, key: string): TriggerRuntimeRef {
    const ref = this.getTriggerByKey(pluginName, key);
    if (!ref) {
      throw new Error(`Trigger capability not registered: ${pluginName}:${key}`);
    }
    return ref;
  }

  getActionById(capabilityId: string): ActionRuntimeRef | undefined {
    return this.actions.get(capabilityId);
  }

  getActionByKey(pluginName: string, key: string): ActionRuntimeRef | undefined {
    return this.actionByKey.get(capabilityKey(pluginName, key));
  }

  requireActionById(capabilityId: string): ActionRuntimeRef {
    const ref = this.getActionById(capabilityId);
    if (!ref) {
      throw new Error(`Action capability not registered: ${capabilityId}`);
    }
    return ref;
  }

  requireActionByKey(pluginName: string, key: string): ActionRuntimeRef {
    const ref = this.getActionByKey(pluginName, key);
    if (!ref) {
      throw new Error(`Action capability not registered: ${pluginName}:${key}`);
    }
    return ref;
  }

  getServiceRegistry(): PluginServiceRegistry {
    return this.services;
  }

  createRuntimeServices(pluginName: string): PluginRuntimeServices {
    return {
      logger: createPluginLogger(pluginName),
      core: this.services.getAllServices(),
    };
  }

  setPluginModule(pluginName: string, module: PluginModule) {
    this.pluginModules.set(pluginName, module);
  }

  getPluginModule(pluginName: string): PluginModule | undefined {
    return this.pluginModules.get(pluginName);
  }

  async removePlugin(pluginName: string) {
    const triggerIds = this.pluginTrigIds.get(pluginName);
    if (triggerIds) {
      for (const id of triggerIds) {
        const ref = this.triggers.get(id);
        if (ref) {
          this.triggers.delete(id);
          this.triggerByKey.delete(capabilityKey(pluginName, ref.capability.key));
        }
      }
      this.pluginTrigIds.delete(pluginName);
    }

    const actionIds = this.pluginActIds.get(pluginName);
    if (actionIds) {
      for (const id of actionIds) {
        const ref = this.actions.get(id);
        if (ref) {
          this.actions.delete(id);
          this.actionByKey.delete(capabilityKey(pluginName, ref.capability.key));
        }
      }
      this.pluginActIds.delete(pluginName);
    }

    const module = this.pluginModules.get(pluginName);
    if (module?.dispose) {
      try {
        await module.dispose();
      } catch (err) {
        createPluginLogger(pluginName).warn(
          { error: err instanceof Error ? err.message : err },
          "Plugin dispose hook failed",
        );
      }
    }
    this.pluginModules.delete(pluginName);
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
          throw new Error(
            `Trigger capability ${cap.key} declared by plugin ${p.name} has no exported handler`,
          );
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
          throw new Error(
            `Action capability ${cap.key} declared by plugin ${p.name} has no exported handler`,
          );
        }
        runtime.registerAction({
          pluginName: p.name,
          capability: { ...cap },
          capabilityId: capabilityRow.id,
          factory,
        });
      }
    }

    if (typeof p.module.register === "function") {
      try {
        await p.module.register({
          plugin: { name: p.name },
          services: runtime.createRuntimeServices(p.name),
        });
      } catch (err) {
        createPluginLogger(p.name).error(
          { error: err instanceof Error ? err.message : err },
          "Plugin register hook failed",
        );
      }
    }

    runtime.setPluginModule(p.name, p.module);
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

async function importPlugin(absDir: string, cacheBust: boolean): Promise<unknown | null> {
  try {
    let url = pathToFileURL(absDir).href;
    if (!url.endsWith("/")) url += "/";
    if (cacheBust) url += `?update=${Date.now()}`;
    return await import(url);
  } catch {
    return null;
  }
}

function normalizePlugin(
  pluginName: string,
  pluginModule: PluginModule | null,
): LoadedPlugin | null {
  if (!pluginModule) return null;
  const parsed = CapabilityArraySchema.safeParse(pluginModule.capabilities ?? []);
  if (!parsed.success) return null;
  const normalized: PluginModule = {
    ...pluginModule,
    capabilities: parsed.data,
  };
  return { name: pluginName, module: normalized, capabilities: normalized.capabilities };
}

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
