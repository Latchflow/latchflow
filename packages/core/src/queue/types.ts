export interface LatchflowQueue {
  enqueueAction(payload: {
    actionDefinitionId: string;
    triggerEventId: string;
    context?: Record<string, unknown>;
  }): Promise<void>;
  consumeActions(
    handler: (msg: {
      actionDefinitionId: string;
      triggerEventId: string;
      context?: Record<string, unknown>;
    }) => Promise<void>,
  ): Promise<void>;
  stop(): Promise<void>;
}

export type QueueFactory = (opts: { config: unknown }) => Promise<LatchflowQueue>;
