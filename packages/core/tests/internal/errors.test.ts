import { describe, it, expect } from "vitest";
import { LatchflowError } from "../../src/internal/errors.js";

describe("LatchflowError", () => {
  it("sets name and message", () => {
    const e = new LatchflowError("boom");
    expect(e.name).toBe("LatchflowError");
    expect(e.message).toBe("boom");
  });
});
