import { afterEach, describe, expect, it } from "vitest";
import { evaluateInputGuards, resetRateLimitState } from "./inputGuards.js";

describe("input guards", () => {
  afterEach(() => {
    resetRateLimitState();
  });

  it("enforces allow and deny params", () => {
    const res1 = evaluateInputGuards(
      { allowParams: ["foo", "bar"], denyParams: ["secret"] },
      { body: { foo: 1, bar: 2 } },
      { evaluationMode: "enforce" },
    );
    expect(res1.ok).toBe(true);

    const res2 = evaluateInputGuards(
      { allowParams: ["foo"], denyParams: [] },
      { body: { foo: 1, extra: 2 } },
      { evaluationMode: "enforce" },
    );
    expect(res2).toMatchObject({ ok: false, code: "ALLOWED_PARAMS" });

    const res3 = evaluateInputGuards(
      { denyParams: ["secret"] },
      { body: { secret: 42 } },
      { evaluationMode: "enforce" },
    );
    expect(res3).toMatchObject({ ok: false, code: "DENIED_PARAM" });
  });

  it("validates value rules and dry-run requirement", () => {
    const ok = evaluateInputGuards(
      {
        valueRules: [
          { path: "payload.type", oneOf: ["A", "B"] },
          { path: "payload.token", matches: "^tok_" },
          { path: "payload.name", maxLen: 5 },
        ],
        dryRunOnly: true,
      },
      { body: { payload: { type: "A", token: "tok_123", name: "abcd" }, dryRun: true } },
      { evaluationMode: "enforce" },
    );
    expect(ok.ok).toBe(true);

    const bad = evaluateInputGuards(
      { valueRules: [{ path: "payload.name", maxLen: 2 }] },
      { body: { payload: { name: "long" } } },
      { evaluationMode: "enforce" },
    );
    expect(bad).toMatchObject({ ok: false, code: "VALUE_RULE" });

    const dryRunMissing = evaluateInputGuards(
      { dryRunOnly: true },
      { body: {} },
      { evaluationMode: "enforce" },
    );
    expect(dryRunMissing).toMatchObject({ ok: false, code: "DRY_RUN_ONLY" });
  });

  it("applies rate limits", () => {
    const guard = { rateLimit: { perMin: 2 } };
    const context = { evaluationMode: "enforce", userId: "user-1", ruleId: "ruleX", rulesHash: "hash" };
    const ok1 = evaluateInputGuards(guard, { body: {} }, context);
    const ok2 = evaluateInputGuards(guard, { body: {} }, context);
    const denied = evaluateInputGuards(guard, { body: {} }, context);
    expect(ok1.ok).toBe(true);
    expect(ok2.ok).toBe(true);
    expect(denied).toMatchObject({ ok: false, code: "RATE_LIMIT" });
  });
});
