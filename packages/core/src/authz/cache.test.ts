import { afterEach, describe, expect, it } from "vitest";
import type { Permission } from "./types.js";
import {
  clearCompiledPermissionsCache,
  getCompiledCacheSize,
  getOrCompilePermissions,
  invalidateCompiledPermissions,
} from "./cache.js";

const baseRules: Permission[] = [
  { id: "one", action: "read", resource: "bundle" },
  { id: "two", action: "update", resource: "bundle", where: { bundleIds: ["a"] } },
];

describe("permission cache", () => {
  afterEach(() => {
    clearCompiledPermissionsCache();
  });

  it("caches compiled result by hash", () => {
    const first = getOrCompilePermissions(baseRules, "hash-1");
    const second = getOrCompilePermissions(baseRules, "hash-1");
    expect(first).toBe(second);
    expect(getCompiledCacheSize()).toBeGreaterThan(0);
  });

  it("recomputes when invalidated", () => {
    const first = getOrCompilePermissions(baseRules, "hash-2");
    invalidateCompiledPermissions(first.rulesHash);
    const second = getOrCompilePermissions(baseRules, "hash-2");
    expect(second).not.toBe(first);
  });

  it("falls back when no hash provided", () => {
    const first = getOrCompilePermissions(baseRules, "");
    const second = getOrCompilePermissions(baseRules, undefined);
    expect(first.rulesHash).toHaveLength(64);
    expect(second.rulesHash).toBe(first.rulesHash);
    expect(second).toBe(first);
  });
});
