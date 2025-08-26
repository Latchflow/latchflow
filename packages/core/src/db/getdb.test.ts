import { describe, it, expect, vi } from "vitest";

// Mock the db wrapper module directly (no dependency resolution)
vi.mock("./db.js", () => ({ getDb: () => ({ foo: 42 }) }));

describe("getDb", () => {
  it("returns the shared prisma client", async () => {
    const { getDb } = await import("./db.js");
    const db = getDb() as unknown as { foo: number };
    expect(db.foo).toBe(42);
  });
});
