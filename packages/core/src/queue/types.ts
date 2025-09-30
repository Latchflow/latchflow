export interface LatchflowQueue {
  enqueueAction(payload: {
    actionDefinitionId: string;
    triggerEventId?: string;
    manualInvokerId?: string;
    context?: Record<string, unknown>;
    attempt?: number;
  }): Promise<void>;
  consumeActions(
    handler: (msg: {
      actionDefinitionId: string;
      triggerEventId?: string;
      manualInvokerId?: string;
      context?: Record<string, unknown>;
      attempt?: number;
    }) => Promise<void>,
  ): Promise<void>;
  stop(): Promise<void>;
}

export type QueueFactory = (opts: { config: unknown }) => Promise<LatchflowQueue>;
