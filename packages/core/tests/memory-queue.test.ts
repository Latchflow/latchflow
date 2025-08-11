import { describe, it, expect } from "vitest";
import { createMemoryQueue } from "../src/queue/memory-queue";

describe("memory-queue", () => {
  it("enqueues and consumes in FIFO order", async () => {
    const queue = await createMemoryQueue({ config: null });
    const seen: string[] = [];
    await queue.consumeActions(async (msg) => {
      seen.push(msg.actionDefinitionId);
      if (seen.length === 3) await queue.stop();
    });

    await queue.enqueueAction({ actionDefinitionId: "a", triggerEventId: "t1" });
    await queue.enqueueAction({ actionDefinitionId: "b", triggerEventId: "t2" });
    await queue.enqueueAction({ actionDefinitionId: "c", triggerEventId: "t3" });

    // Allow event loop to process
    await new Promise((r) => setTimeout(r, 10));

    expect(seen).toEqual(["a", "b", "c"]);
  });
});
