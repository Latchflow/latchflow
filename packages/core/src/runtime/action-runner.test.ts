import { describe, it, expect, vi, beforeEach } from "vitest";
import { startActionConsumer } from "../runtime/action-runner.js";
import { createMemoryQueue } from "../queue/memory-queue.js";
import { getDb } from "../db/db.js";

const dbSpies = vi.hoisted(() => {
  const created: unknown[] = [];
  const updated: unknown[] = [];
  const create = vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
    const obj = { id: "inv_1", ...data };
    created.push(obj);
    return obj;
  });
  const update = vi.fn(
    async ({ where: { id }, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      updated.push({ id, data });
      return { id, ...data } as Record<string, unknown>;
    },
  );
  return { created, updated, create, update };
});

vi.mock("../db/db.js", () => ({
  getDb: () => ({
    actionInvocation: {
      create: dbSpies.create,
      update: dbSpies.update,
    },
  }),
}));

describe("action-runner", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates and finalizes invocation for successful action", async () => {
    const queue = await createMemoryQueue({ config: null });
    await startActionConsumer(queue, {
      executeAction: async () => ({ ok: true }),
    });
    await queue.enqueueAction({
      actionDefinitionId: "A",
      triggerEventId: "T",
      manualInvokerId: "tester",
    });
    await new Promise((r) => setTimeout(r, 10));
    const dbClient = getDb() as any;
    expect(dbClient.actionInvocation.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ manualInvokerId: "tester" }),
      }),
    );
    expect(dbSpies.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "inv_1" },
        data: expect.objectContaining({ status: "SUCCESS" }),
      }),
    );
  });
});
