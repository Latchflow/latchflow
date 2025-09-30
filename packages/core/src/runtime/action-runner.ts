import { LatchflowQueue } from "../queue/types.js";
import { getDb } from "../db/db.js";
import type { Prisma } from "@latchflow/db";
import type { PluginRuntimeRegistry } from "../plugins/plugin-loader.js";
import type { ActionRuntimeContext } from "../plugins/contracts.js";
import { createPluginLogger } from "../observability/logger.js";

type QueueMessage = {
  actionDefinitionId: string;
  triggerEventId?: string;
  manualInvokerId?: string;
  context?: Record<string, unknown>;
};

export async function startActionConsumer(
  queue: LatchflowQueue,
  deps: {
    registry: PluginRuntimeRegistry;
  },
) {
  const db = getDb();
  await queue.consumeActions(async (msg: QueueMessage) => {
    const invocation = await db.actionInvocation.create({
      data: {
        actionDefinitionId: msg.actionDefinitionId,
        triggerEventId: msg.triggerEventId ?? null,
        manualInvokerId: msg.manualInvokerId ?? null,
        status: "PENDING",
      },
    });

    const finishInvocation = async (data: Prisma.ActionInvocationUpdateInput): Promise<void> => {
      await db.actionInvocation.update({
        where: { id: invocation.id },
        data,
      });
    };

    try {
      const definition = await db.actionDefinition.findUnique({
        where: { id: msg.actionDefinitionId },
        select: {
          id: true,
          capabilityId: true,
          config: true,
          isEnabled: true,
        },
      });

      if (!definition || definition.isEnabled === false) {
        await finishInvocation({
          status: "SKIPPED_DISABLED",
          result: { reason: "ACTION_DISABLED" } as unknown as Prisma.InputJsonValue,
          completedAt: new Date(),
        });
        return;
      }

      const ref = deps.registry.requireActionById(definition.capabilityId);
      const logger = createPluginLogger(ref.pluginName);
      const services = deps.registry.createRuntimeServices(ref.pluginName);

      const context: ActionRuntimeContext = {
        definitionId: definition.id,
        capability: ref.capability,
        plugin: { name: ref.pluginName },
        services,
      };

      const runtime = await ref.factory(context);
      try {
        const executionResult = await runtime.execute({
          config: definition.config as unknown,
          secrets: null,
          payload: msg.context,
          invocation: {
            invocationId: invocation.id,
            triggerEventId: msg.triggerEventId,
            manualInvokerId: msg.manualInvokerId,
            context: msg.context,
          },
        });

        await finishInvocation({
          status: "SUCCESS",
          result: (executionResult ?? null) as unknown as Prisma.InputJsonValue,
          completedAt: new Date(),
        });
      } finally {
        if (typeof runtime.dispose === "function") {
          try {
            await runtime.dispose();
          } catch (err) {
            logger.warn(
              { error: (err as Error).message, actionDefinitionId: definition.id },
              "Action runtime dispose failed",
            );
          }
        }
      }
    } catch (e) {
      const error = e as Error;
      await finishInvocation({
        status: "FAILED",
        result: { error: error.message } as unknown as Prisma.InputJsonValue,
        completedAt: new Date(),
      });
    }
  });
}
