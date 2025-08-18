import { describe, it, expect, vi } from "vitest";

vi.mock("@latchflow/db", () => ({ prisma: { foo: 42 } }));

describe("getDb", () => {
  it("returns the shared prisma client", async () => {
    const { getDb } = await import("../../src/db.js");
    const db = getDb() as unknown as { foo: number };
    expect(db.foo).toBe(42);
  });
});
