import { describe, it, expect } from "vitest";

import { computePatch, applyPatch, type JsonPatchOp } from "./patch.js";

describe("history/patch", () => {
  describe("computePatch", () => {
    it("returns empty when values are equal (primitives)", () => {
      expect(computePatch(42, 42)).toEqual([]);
      expect(computePatch("a", "a")).toEqual([]);
      expect(computePatch(null, null)).toEqual([]);
    });

    it("returns root replace when different", () => {
      const next = { a: 1 };
      const ops = computePatch({}, next);
      expect(ops).toEqual([{ op: "replace", path: "/", value: next }] satisfies JsonPatchOp[]);
    });
  });

  describe("applyPatch", () => {
    it("applies root replace", () => {
      const state = { x: 1 };
      const patch: JsonPatchOp[] = [{ op: "replace", path: "/", value: { y: 2 } }];
      expect(applyPatch(state, patch)).toEqual({ y: 2 });
    });

    it("ignores non-root ops in minimal impl", () => {
      const state = { x: 1 };
      const patch: JsonPatchOp[] = [{ op: "replace", path: "/a", value: 2 }];
      expect(applyPatch(state, patch)).toEqual(state);
    });

    it("returns original state when empty patch", () => {
      expect(applyPatch({ a: 1 }, [])).toEqual({ a: 1 });
    });
  });
});
