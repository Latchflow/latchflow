import { LatchflowQueue, QueueFactory } from "./types.js";

type Msg = {
  actionDefinitionId: string;
  triggerEventId?: string;
  manualInvokerId?: string;
  context?: Record<string, unknown>;
};

export const createMemoryQueue: QueueFactory = async () => {
  const queue: Msg[] = [];
  let running = true;
  let consumer: ((m: Msg) => Promise<void>) | null = null;
  let resolveWaiter: (() => void) | null = null;

  function notify() {
    if (resolveWaiter) {
      resolveWaiter();
      resolveWaiter = null;
    }
  }

  async function pump() {
    while (running) {
      if (!consumer) {
        await new Promise<void>((resolve) => {
          resolveWaiter = resolve;
        });
        continue;
      }
      const msg = queue.shift();
      if (!msg) {
        await new Promise<void>((resolve) => {
          resolveWaiter = resolve;
        });
        continue;
      }
      await consumer(msg);
    }
  }

  // start pump loop
  pump().catch(() => void 0);

  const api: LatchflowQueue = {
    async enqueueAction(payload: Msg) {
      queue.push(payload);
      notify();
    },
    async consumeActions(handler: (msg: Msg) => Promise<void>) {
      consumer = handler;
      notify();
    },
    async stop() {
      running = false;
      notify();
    },
  };

  return api;
};
