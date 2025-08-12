import { LatchflowQueue } from "../queue/types.js";
import { getDb } from "../db.js";

export async function startActionConsumer(
  queue: LatchflowQueue,
  deps: {
    executeAction: (msg: {
      actionDefinitionId: string;
      triggerEventId: string;
      context?: Record<string, unknown>;
    }) => Promise<unknown>;
  },
) {
  const db = getDb();
  await queue.consumeActions(async (msg) => {
    const inv = await db.actionInvocation.create({
      data: {
        actionDefinitionId: msg.actionDefinitionId,
        triggerEventId: msg.triggerEventId,
        status: "PENDING",
      },
    });

    try {
      const result = (await deps.executeAction(msg)) as unknown;
      await db.actionInvocation.update({
        where: { id: inv.id },
        data: { status: "SUCCESS", result: result as unknown, completedAt: new Date() },
      });
    } catch (e) {
      const errorResult = { error: (e as Error).message } as unknown;
      await db.actionInvocation.update({
        where: { id: inv.id },
        data: {
          status: "FAILED",
          result: errorResult,
          completedAt: new Date(),
        },
      });
    }
  });
}
