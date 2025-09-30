import { getDb } from "../db/db.js";
import type { Prisma } from "@latchflow/db";

type FireMsg = {
  actionDefinitionId: string;
  triggerEventId: string;
  context?: Record<string, unknown>;
};

type TriggerEmitPayload = {
  context?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  scheduledFor?: Date;
};

export async function startTriggerRunner(opts: { onFire: (msg: FireMsg) => Promise<void> }) {
  const db = getDb();

  async function fireTriggerOnce(
    triggerDefinitionId: string,
    payload: TriggerEmitPayload = {},
  ): Promise<string> {
    // Insert TriggerEvent
    const evt = await db.triggerEvent.create({
      data: {
        triggerDefinitionId,
        context: (payload.context ?? null) as Prisma.InputJsonValue | Prisma.JsonNullValueInput,
      },
    });

    // Back-compat: some tests mock an older TriggerAction mapping.
    type TriggerActionDelegate = {
      findMany: (args: unknown) => Promise<Array<{ actionDefinitionId: string }>>;
    };
    const triggerAction = (db as { triggerAction?: TriggerActionDelegate }).triggerAction;
    const maybeTriggerActionFindMany = triggerAction?.findMany;

    if (maybeTriggerActionFindMany) {
      const mappings = await maybeTriggerActionFindMany({
        where: { triggerDefinitionId, isEnabled: true },
        orderBy: { sortOrder: "asc" },
      });
      for (const m of mappings) {
        await opts.onFire({
          actionDefinitionId: m.actionDefinitionId,
          triggerEventId: evt.id,
          context: payload.context,
        });
      }
    } else {
      // Resolve enabled pipelines attached to this trigger, then enabled steps/actions
      const pipelineTriggers = await db.pipelineTrigger.findMany({
        where: {
          triggerId: triggerDefinitionId,
          isEnabled: true,
          pipeline: { isEnabled: true },
        },
        orderBy: { sortOrder: "asc" },
        select: {
          pipeline: {
            select: {
              id: true,
              steps: {
                where: { isEnabled: true, action: { isEnabled: true } },
                orderBy: { sortOrder: "asc" },
                select: { actionId: true },
              },
            },
          },
        },
      });

      for (const pt of pipelineTriggers) {
        for (const step of pt.pipeline.steps) {
          await opts.onFire({
            actionDefinitionId: step.actionId,
            triggerEventId: evt.id,
            context: payload.context,
          });
        }
      }
    }

    return evt.id;
  }

  return {
    fireTriggerOnce,
  };
}
