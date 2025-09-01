import { describe, it, expect } from "vitest";
import { hasAll, hasAny } from "./scopes.js";

describe("auth scopes helpers", () => {
  it("hasAll checks all required", () => {
    expect(hasAll(["a", "b"], ["a", "b", "c"])).toBe(true);
    expect(hasAll(["a", "z"], ["a", "b"])).toBe(false);
  });
  it("hasAny checks any required", () => {
    expect(hasAny(["x", "b"], ["a", "b"])).toBe(true);
    expect(hasAny(["x", "y"], ["a", "b"])).toBe(false);
  });
});
