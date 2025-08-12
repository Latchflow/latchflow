import { describe, it, expect, vi } from "vitest";
import { startTriggerRunner } from "../src/runtime/trigger-runner";

vi.mock("../src/db", () => {
  return {
    getDb: () => ({
      triggerEvent: {
        create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
          id: "evt_1",
          ...data,
        })),
      },
      triggerAction: {
        findMany: vi.fn(async () => [
          { actionDefinitionId: "act_1", sortOrder: 0, isEnabled: true },
          { actionDefinitionId: "act_2", sortOrder: 1, isEnabled: true },
        ]),
      },
    }),
  };
});

describe("trigger-runner", () => {
  it("creates event and emits actions", async () => {
    const fired: Array<
      { actionDefinitionId: string; triggerEventId: string } & Record<string, unknown>
    > = [];
    const runner = await startTriggerRunner({ onFire: async (m) => fired.push(m) });
    await runner.fireTriggerOnce("trig_1", { foo: "bar" });
    expect(fired.map((f) => f.actionDefinitionId)).toEqual(["act_1", "act_2"]);
    expect(fired[0].triggerEventId).toBe("evt_1");
  });
});
