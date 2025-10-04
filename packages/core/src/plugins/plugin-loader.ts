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
  type ProviderDescriptor,
  isTriggerCapability,
  isActionCapability,
  isPluginModule,
  isProviderDescriptor,
} from "./contracts.js";
import { createPluginLogger } from "../observability/logger.js";
import {
  PluginServiceRegistry,
  type PluginServiceRuntimeContextInit,
} from "../services/plugin-services.js";
import { ensureProviderConfig } from "./provider-config.js";
import type { SystemConfigService } from "../config/system-config-core.js";
import type { TriggerRuntimeServices, TriggerEmitPayload } from "./contracts.js";

export interface TriggerDefinitionHealth {
  definitionId: string;
  capabilityId: string;
  capabilityKey: string;
  pluginId: string;
  pluginName: string;
  isRunning: boolean;
  emitCount: number;
  lastStartAt?: Date;
  lastStopAt?: Date;
  lastEmitAt?: Date;
  lastError?: { message: string; at: Date };
}

export interface ActionDefinitionHealth {
  definitionId: string;
  capabilityId: string;
  capabilityKey: string;
  pluginId: string;
  pluginName: string;
  lastStatus?: string;
  lastInvocationAt?: Date;
  lastDurationMs?: number;
  successCount: number;
  retryCount: number;
  failureCount: number;
  skippedCount: number;
  lastError?: { message: string; at: Date };
}

export interface PluginRuntimeSummary {
  generatedAt: Date;
  pluginCount: number;
  triggerDefinitions: {
    total: number;
    running: number;
    lastActivityAt?: Date;
    totalEmitCount: number;
    errorCount: number;
  };
  actionDefinitions: {
    total: number;
    lastInvocationAt?: Date;
    successCount: number;
    retryCount: number;
    failureCount: number;
    skippedCount: number;
    errorCount: number;
  };
}

function cloneDate(value?: Date) {
  return value ? new Date(value) : undefined;
}

function cloneTriggerHealth(record: TriggerDefinitionHealth): TriggerDefinitionHealth {
  return {
    ...record,
    lastStartAt: cloneDate(record.lastStartAt),
    lastStopAt: cloneDate(record.lastStopAt),
    lastEmitAt: cloneDate(record.lastEmitAt),
    lastError: record.lastError
      ? { message: record.lastError.message, at: cloneDate(record.lastError.at)! }
      : undefined,
  };
}

function cloneActionHealth(record: ActionDefinitionHealth): ActionDefinitionHealth {
  return {
    ...record,
    lastInvocationAt: cloneDate(record.lastInvocationAt),
    lastError: record.lastError
      ? { message: record.lastError.message, at: cloneDate(record.lastError.at)! }
      : undefined,
  };
}

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
  private triggerHealth = new Map<string, TriggerDefinitionHealth>();
  private actionHealth = new Map<string, ActionDefinitionHealth>();

  constructor(private readonly services: PluginServiceRegistry) {}

  private ensureTriggerHealth(
    definitionId: string,
    ref: TriggerRuntimeRef,
  ): TriggerDefinitionHealth {
    let record = this.triggerHealth.get(definitionId);
    if (!record) {
      record = {
        definitionId,
        capabilityId: ref.capabilityId,
        capabilityKey: ref.capability.key,
        pluginId: ref.pluginId,
        pluginName: ref.pluginName,
        isRunning: false,
        emitCount: 0,
      };
      this.triggerHealth.set(definitionId, record);
    }
    return record;
  }

  private ensureActionHealth(definitionId: string, ref: ActionRuntimeRef): ActionDefinitionHealth {
    let record = this.actionHealth.get(definitionId);
    if (!record) {
      record = {
        definitionId,
        capabilityId: ref.capabilityId,
        capabilityKey: ref.capability.key,
        pluginId: ref.pluginId,
        pluginName: ref.pluginName,
        successCount: 0,
        retryCount: 0,
        failureCount: 0,
        skippedCount: 0,
      };
      this.actionHealth.set(definitionId, record);
    }
    return record;
  }

  private removeHealthForPlugin(pluginId: string) {
    for (const [key, record] of Array.from(this.triggerHealth.entries())) {
      if (record.pluginId === pluginId) {
        this.triggerHealth.delete(key);
      }
    }
    for (const [key, record] of Array.from(this.actionHealth.entries())) {
      if (record.pluginId === pluginId) {
        this.actionHealth.delete(key);
      }
    }
  }

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

  markTriggerDefinitionStarted(definitionId: string, ref: TriggerRuntimeRef) {
    const record = this.ensureTriggerHealth(definitionId, ref);
    record.isRunning = true;
    record.lastStartAt = new Date();
  }

  markTriggerDefinitionStopped(definitionId: string, ref: TriggerRuntimeRef, error?: Error) {
    const record = this.ensureTriggerHealth(definitionId, ref);
    record.isRunning = false;
    record.lastStopAt = new Date();
    if (error) {
      record.lastError = { message: error.message, at: record.lastStopAt };
    }
  }

  recordTriggerDefinitionEmit(
    definitionId: string,
    ref: TriggerRuntimeRef,
    outcome: "SUCCEEDED" | "FAILED",
    error?: Error,
  ) {
    const record = this.ensureTriggerHealth(definitionId, ref);
    record.emitCount += 1;
    record.lastEmitAt = new Date();
    if (outcome === "FAILED" && error) {
      record.lastError = { message: error.message, at: record.lastEmitAt };
    }
  }

  getTriggerDefinitionHealth(definitionId: string): TriggerDefinitionHealth | undefined {
    const record = this.triggerHealth.get(definitionId);
    return record ? cloneTriggerHealth(record) : undefined;
  }

  recordActionDefinitionInvocation(
    ref: ActionRuntimeRef,
    definitionId: string,
    status: string,
    durationMs?: number,
    error?: Error,
  ) {
    const record = this.ensureActionHealth(definitionId, ref);
    record.lastStatus = status;
    record.lastInvocationAt = new Date();
    if (typeof durationMs === "number") {
      record.lastDurationMs = durationMs;
    }
    switch (status) {
      case "SUCCESS":
        record.successCount += 1;
        record.lastError = undefined;
        break;
      case "RETRYING":
        record.retryCount += 1;
        if (error) {
          record.lastError = { message: error.message, at: new Date() };
        }
        break;
      case "SKIPPED_DISABLED":
        record.skippedCount += 1;
        break;
      default:
        if (status.startsWith("FAILED")) {
          record.failureCount += 1;
          if (error) {
            record.lastError = { message: error.message, at: new Date() };
          }
        }
        break;
    }
  }

  getActionDefinitionHealth(definitionId: string): ActionDefinitionHealth | undefined {
    const record = this.actionHealth.get(definitionId);
    return record ? cloneActionHealth(record) : undefined;
  }

  getPluginRuntimeSnapshot(pluginId: string) {
    const triggerHealth = Array.from(this.triggerHealth.values())
      .filter((record) => record.pluginId === pluginId)
      .map(cloneTriggerHealth);
    const actionHealth = Array.from(this.actionHealth.values())
      .filter((record) => record.pluginId === pluginId)
      .map(cloneActionHealth);
    return { triggers: triggerHealth, actions: actionHealth };
  }

  getRuntimeHealthSummary(): PluginRuntimeSummary {
    const generatedAt = new Date();
    const triggerRecords = Array.from(this.triggerHealth.values());
    const actionRecords = Array.from(this.actionHealth.values());

    const pluginIds = new Set<string>();
    for (const record of triggerRecords) {
      pluginIds.add(record.pluginId);
    }
    for (const record of actionRecords) {
      pluginIds.add(record.pluginId);
    }

    const runningTriggers = triggerRecords.filter((record) => record.isRunning).length;
    const totalEmitCount = triggerRecords.reduce((sum, record) => sum + record.emitCount, 0);
    const triggerErrors = triggerRecords.reduce(
      (sum, record) => sum + (record.lastError ? 1 : 0),
      0,
    );
    const lastTriggerActivityAt = triggerRecords.reduce<Date | undefined>((latest, record) => {
      if (!record.lastEmitAt) return latest;
      if (!latest || record.lastEmitAt > latest) return record.lastEmitAt;
      return latest;
    }, undefined);

    const successCount = actionRecords.reduce((sum, record) => sum + record.successCount, 0);
    const retryCount = actionRecords.reduce((sum, record) => sum + record.retryCount, 0);
    const failureCount = actionRecords.reduce((sum, record) => sum + record.failureCount, 0);
    const skippedCount = actionRecords.reduce((sum, record) => sum + record.skippedCount, 0);
    const actionErrors = actionRecords.reduce((sum, record) => sum + (record.lastError ? 1 : 0), 0);
    const lastActionInvocationAt = actionRecords.reduce<Date | undefined>((latest, record) => {
      if (!record.lastInvocationAt) return latest;
      if (!latest || record.lastInvocationAt > latest) return record.lastInvocationAt;
      return latest;
    }, undefined);

    return {
      generatedAt,
      pluginCount: pluginIds.size,
      triggerDefinitions: {
        total: triggerRecords.length,
        running: runningTriggers,
        totalEmitCount,
        errorCount: triggerErrors,
        lastActivityAt: lastTriggerActivityAt ? new Date(lastTriggerActivityAt) : undefined,
      },
      actionDefinitions: {
        total: actionRecords.length,
        successCount,
        retryCount,
        failureCount,
        skippedCount,
        errorCount: actionErrors,
        lastInvocationAt: lastActionInvocationAt ? new Date(lastActionInvocationAt) : undefined,
      },
    };
  }

  createRuntimeServices(baseContext: PluginServiceRuntimeContextInit): PluginRuntimeServices {
    return {
      logger: createPluginLogger(baseContext.pluginName),
      core: this.services.createScopedServices(baseContext),
    };
  }

  createTriggerServices(
    baseContext: PluginServiceRuntimeContextInit,
    emit: (payload?: TriggerEmitPayload) => Promise<void>,
  ): TriggerRuntimeServices {
    return {
      ...this.createRuntimeServices(baseContext),
      emit,
    };
  }

  setPluginModule(pluginName: string, module: PluginModule) {
    this.pluginModules.set(pluginName, module);
  }

  getPluginModule(pluginName: string): PluginModule | undefined {
    return this.pluginModules.get(pluginName);
  }

  async removePlugin(pluginName: string) {
    let pluginId: string | undefined;
    const triggerIds = this.pluginTrigIds.get(pluginName);
    if (triggerIds) {
      for (const id of triggerIds) {
        const ref = this.triggers.get(id);
        if (ref) {
          if (!pluginId) {
            pluginId = ref.pluginId;
          }
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
          if (!pluginId) {
            pluginId = ref.pluginId;
          }
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
    if (pluginId) {
      this.removeHealthForPlugin(pluginId);
    }
  }
}

export async function upsertPluginsIntoDb(
  db: DbClient,
  plugins: LoadedPlugin[],
  runtime: PluginRuntimeRegistry,
  options?: { systemConfig?: SystemConfigService },
) {
  for (const p of plugins) {
    await runtime.removePlugin(p.name);

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
          pluginId: pluginRow.id,
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
          pluginId: pluginRow.id,
          capability: { ...cap },
          capabilityId: capabilityRow.id,
          factory,
        });
      }
    }

    if (Array.isArray(p.module.providers) && p.module.providers.length > 0) {
      if (!options?.systemConfig) {
        createPluginLogger(p.name).warn(
          "SystemConfig service unavailable; skipping provider registration",
        );
      } else {
        for (const descriptor of p.module.providers as ProviderDescriptor[]) {
          if (!isProviderDescriptor(descriptor)) continue;
          const providerLogger = createPluginLogger(`${p.name}:${descriptor.id}`);
          try {
            const config = await ensureProviderConfig({
              descriptor,
              systemConfig: options.systemConfig,
              pluginName: p.name,
              logger: providerLogger,
            });

            await descriptor.register({
              plugin: { name: p.name },
              logger: providerLogger,
              config,
              services: runtime.createRuntimeServices({
                pluginName: p.name,
                pluginId: pluginRow.id,
                capabilityId: `${pluginRow.id}:provider:${descriptor.id}`,
                capabilityKey: `provider:${descriptor.id}`,
                executionKind: "register",
              }),
            });
          } catch (err) {
            providerLogger.warn(
              { error: err instanceof Error ? err.message : err },
              "Provider registration skipped due to configuration error",
            );
          }
        }
      }
    }

    if (typeof p.module.register === "function") {
      try {
        await p.module.register({
          plugin: { name: p.name },
          services: runtime.createRuntimeServices({
            pluginName: p.name,
            pluginId: pluginRow.id,
            capabilityId: `${pluginRow.id}:register`,
            capabilityKey: "register",
            executionKind: "register",
          }),
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
  pluginId: string;
  capabilityId: string;
  capability: TriggerCapability;
  factory: TriggerFactory;
};

export type ActionRuntimeRef = {
  pluginName: string;
  pluginId: string;
  capabilityId: string;
  capability: ActionCapability;
  factory: ActionFactory;
};

async function importPlugin(absDir: string, cacheBust: boolean): Promise<unknown | null> {
  const cacheSuffix = cacheBust ? `?update=${Date.now()}` : "";
  const attempts: string[] = [];

  const pkgJsonPath = path.join(absDir, "package.json");
  if (fs.existsSync(pkgJsonPath)) {
    try {
      const pkg = JSON.parse(await fs.promises.readFile(pkgJsonPath, "utf8")) as {
        main?: string;
        module?: string;
      };
      const entry = pkg.module ?? pkg.main;
      if (entry) {
        attempts.push(pathToFileURL(path.join(absDir, entry)).href + cacheSuffix);
      }
    } catch {
      // ignore pkg parse failure
    }
  }

  attempts.push(pathToFileURL(path.join(absDir, "index.js")).href + cacheSuffix);
  let dirUrl = pathToFileURL(absDir).href;
  if (!dirUrl.endsWith("/")) dirUrl += "/";
  attempts.push(dirUrl + cacheSuffix);

  for (const attempt of attempts) {
    try {
      return await import(attempt);
    } catch {
      // continue
    }
  }
  return null;
}

function normalizePlugin(
  pluginName: string,
  pluginModule: PluginModule | null,
): LoadedPlugin | null {
  if (!pluginModule) return null;
  const parsed = CapabilityArraySchema.safeParse(pluginModule.capabilities ?? []);
  if (!parsed.success) return null;
  const finalName =
    typeof pluginModule.name === "string" && pluginModule.name.length > 0
      ? pluginModule.name
      : pluginName;
  const normalized: PluginModule = {
    ...pluginModule,
    capabilities: parsed.data,
  };
  return { name: finalName, module: normalized, capabilities: normalized.capabilities };
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
