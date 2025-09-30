import type { DbClient } from "../db/db.js";
import { createPluginLogger } from "../observability/logger.js";
import { decryptConfig } from "../plugins/config-encryption.js";
import type {
  TriggerRuntime,
  TriggerRuntimeContext,
  TriggerRuntimeServices,
  TriggerEmitPayload,
} from "../plugins/contracts.js";
import type { PluginRuntimeRegistry, TriggerRuntimeRef } from "../plugins/plugin-loader.js";
import { recordPluginTriggerAudit } from "../audit/plugin-audit.js";
import type { PluginServiceRuntimeContextInit } from "../services/plugin-services.js";

export interface TriggerRuntimeManagerOptions {
  db: DbClient;
  registry: PluginRuntimeRegistry;
  fireTrigger: (triggerDefinitionId: string, payload?: TriggerEmitPayload) => Promise<string>;
  encryption: import("../plugins/config-encryption.js").ConfigEncryptionOptions;
}

interface ManagedTrigger {
  ref: TriggerRuntimeRef;
  runtime: TriggerRuntime;
}

export class TriggerRuntimeManager {
  private readonly log = createPluginLogger("trigger-manager");
  private readonly runtimes = new Map<string, ManagedTrigger>();

  constructor(private readonly options: TriggerRuntimeManagerOptions) {}

  async startAll() {
    const triggers = await this.options.db.triggerDefinition.findMany({
      where: { isEnabled: true },
      select: { id: true, capabilityId: true, config: true },
    });
    for (const trigger of triggers) {
      try {
        await this.startTrigger(trigger.id, trigger.capabilityId, trigger.config);
      } catch (err) {
        this.log.error(
          { triggerDefinitionId: trigger.id, error: (err as Error).message },
          "Failed to start trigger runtime",
        );
      }
    }
  }

  async stopAll() {
    const stopPromises: Promise<void>[] = [];
    for (const [definitionId, managed] of this.runtimes.entries()) {
      stopPromises.push(this.stopTrigger(definitionId, managed));
    }
    await Promise.all(stopPromises);
    this.runtimes.clear();
  }

  async reloadTrigger(definitionId: string) {
    const existing = this.runtimes.get(definitionId);
    if (existing) {
      await this.stopTrigger(definitionId, existing);
      this.runtimes.delete(definitionId);
    }
    const definition = await this.options.db.triggerDefinition.findUnique({
      where: { id: definitionId },
      select: { id: true, capabilityId: true, config: true, isEnabled: true },
    });
    if (!definition || definition.isEnabled === false) {
      this.log.info(
        { triggerDefinitionId: definitionId },
        "Trigger disabled or missing; runtime removed",
      );
      return;
    }
    await this.startTrigger(definition.id, definition.capabilityId, definition.config);
  }

  async notifyConfigChange(definitionId: string, config: unknown) {
    const managed = this.runtimes.get(definitionId);
    if (!managed) return;
    if (typeof managed.runtime.onConfigChange === "function") {
      await managed.runtime.onConfigChange(decryptConfig(config, this.options.encryption));
    } else {
      await this.reloadTrigger(definitionId);
    }
  }

  private async startTrigger(definitionId: string, capabilityId: string, config: unknown) {
    const ref = this.options.registry.requireTriggerById(capabilityId);
    const baseContext: PluginServiceRuntimeContextInit = {
      pluginName: ref.pluginName,
      pluginId: ref.pluginId,
      capabilityId: ref.capabilityId,
      capabilityKey: ref.capability.key,
      executionKind: "trigger",
      definitionId,
    };
    const services: TriggerRuntimeServices = this.options.registry.createTriggerServices(
      baseContext,
      async (payload) => {
        await recordPluginTriggerAudit({
          timestamp: new Date(),
          pluginName: ref.pluginName,
          capabilityKey: ref.capability.key,
          triggerDefinitionId: definitionId,
          phase: "STARTED",
        });
        try {
          const eventId = await this.options.fireTrigger(definitionId, payload);
          await recordPluginTriggerAudit({
            timestamp: new Date(),
            pluginName: ref.pluginName,
            capabilityKey: ref.capability.key,
            triggerDefinitionId: definitionId,
            triggerEventId: eventId,
            phase: "SUCCEEDED",
          });
        } catch (err) {
          await recordPluginTriggerAudit({
            timestamp: new Date(),
            pluginName: ref.pluginName,
            capabilityKey: ref.capability.key,
            triggerDefinitionId: definitionId,
            phase: "FAILED",
            message: (err as Error).message,
          });
          throw err;
        }
      },
    );

    const context: TriggerRuntimeContext = {
      definitionId,
      capability: ref.capability,
      plugin: { name: ref.pluginName },
      config: decryptConfig(config, this.options.encryption),
      secrets: null,
      services,
    };

    const runtime = await ref.factory(context);
    await runtime.start();
    this.runtimes.set(definitionId, { ref, runtime });
    this.log.info({ triggerDefinitionId: definitionId }, "Trigger runtime started");
  }

  private async stopTrigger(definitionId: string, managed: ManagedTrigger) {
    try {
      await managed.runtime.stop();
    } catch (err) {
      this.log.warn(
        { triggerDefinitionId: definitionId, error: (err as Error).message },
        "Trigger runtime stop failed",
      );
    }
    if (typeof managed.runtime.dispose === "function") {
      try {
        await managed.runtime.dispose();
      } catch (err) {
        this.log.warn(
          { triggerDefinitionId: definitionId, error: (err as Error).message },
          "Trigger runtime dispose failed",
        );
      }
    }
  }
}
