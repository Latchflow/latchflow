import { describe, expect, it } from "vitest";
import type { Permission } from "./types.js";
import { compilePermissions, computeRulesHash } from "./compile.js";

describe("compilePermissions", () => {
  const baseRules: Permission[] = [
    {
      id: "rule-1",
      source: "preset",
      action: "read",
      resource: "bundle",
      where: { bundleIds: ["a", "b"] },
    },
    {
      id: "rule-2",
      source: "direct",
      action: "update",
      resource: "bundle",
      input: { allowParams: ["name"] },
    },
    {
      id: "rule-3",
      source: "direct",
      action: "read",
      resource: "*",
    },
  ];

  it("builds compiled map with wildcard expansion", () => {
    const { compiled, rules, rulesHash } = compilePermissions(baseRules);
    expect(rulesHash).toMatch(/^[a-f0-9]{64}$/);
    expect(rules).toHaveLength(3);

    const readBucket = compiled["bundle"].read;
    expect(readBucket).toHaveLength(1);
    expect(readBucket?.[0].id).toBe("rule-1");

    const wildcardBucket = compiled["*"].read;
    expect(wildcardBucket).toHaveLength(2);
    expect(wildcardBucket?.map((r) => r.id)).toEqual(["rule-1", "rule-3"]);

    const updateBucket = compiled["bundle"].update;
    expect(updateBucket).toHaveLength(1);
    expect(updateBucket?.[0].input?.allowParams).toEqual(["name"]);
  });

  it("falls back to provided hash when canonicalization fails", () => {
    const broken: Permission[] = [
      {
        get action() {
          throw new Error("boom");
        },
        resource: "bundle",
      } as unknown as Permission,
    ];
    const bundle = compilePermissions(broken, "fallback-hash");
    expect(bundle.rulesHash).toBe("fallback-hash");
  });
});

describe("computeRulesHash", () => {
  it("is stable across runs", () => {
    const rules: Permission[] = [
      { action: "read", resource: "bundle", where: { bundleIds: ["b", "a"] } },
      { action: "create", resource: "bundle", input: { allowParams: ["name"] } },
    ];
    const first = computeRulesHash(rules);
    const second = computeRulesHash(rules);
    expect(first).toBe(second);
  });
});
