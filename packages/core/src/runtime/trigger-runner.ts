import { getDb } from "../db";

type FireMsg = {
  actionDefinitionId: string;
  triggerEventId: string;
  context?: Record<string, unknown>;
};

export async function startTriggerRunner(opts: { onFire: (msg: FireMsg) => Promise<void> }) {
  const db = getDb();

  async function fireTriggerOnce(
    triggerDefinitionId: string,
    context: Record<string, unknown> = {},
  ) {
    // Insert TriggerEvent
    const evt = await db.triggerEvent.create({
      data: { triggerDefinitionId, context },
    });

    // Resolve enabled actions mapped via TriggerAction
    const mappings = await db.triggerAction.findMany({
      where: { triggerDefinitionId, isEnabled: true },
      orderBy: { sortOrder: "asc" },
    });

    for (const m of mappings) {
      await opts.onFire({
        actionDefinitionId: m.actionDefinitionId,
        triggerEventId: evt.id,
        context,
      });
    }
  }

  return {
    fireTriggerOnce,
  };
}
