import { describe, it, expect, vi } from "vitest";
import { logDecision } from "./decisionLog.js";

describe("authz/decisionLog", () => {
  it("emits a JSON line with expected fields", () => {
    const spy = vi.spyOn(console, "info").mockImplementation(() => {});
    logDecision({
      decision: "ALLOW",
      reason: "ADMIN",
      userId: "u1",
      action: "read",
      resource: "plugin",
    });
    expect(spy).toHaveBeenCalledOnce();
    const arg = (spy.mock.calls[0]?.[0] as string) ?? "{}";
    const obj = JSON.parse(arg);
    expect(obj.kind).toBe("authz_decision");
    expect(obj.decision).toBe("ALLOW");
    expect(obj.reason).toBe("ADMIN");
    expect(obj.userId).toBe("u1");
    spy.mockRestore();
  });
});
