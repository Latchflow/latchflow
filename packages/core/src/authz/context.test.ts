import { describe, it, expect } from "vitest";
import { buildContext } from "./context.js";

describe("authz/context", () => {
  it("extracts ADMIN role from user.role and ids from params", () => {
    const ctx = buildContext({
      params: { pipelineId: "p1", actionId: "a1" },
      user: { id: "u1", role: "ADMIN", isActive: true },
    } as any);
    expect(ctx.userId).toBe("u1");
    expect(ctx.role).toBe("ADMIN");
    expect(ctx.isActive).toBe(true);
    expect(ctx.ids.pipelineId).toBe("p1");
    expect(ctx.ids.actionId).toBe("a1");
  });

  it("handles missing user gracefully", () => {
    const ctx = buildContext({} as any);
    expect(ctx.userId).toBe("");
    expect(ctx.role).toBe("UNKNOWN");
    expect(ctx.isActive).toBe(true);
  });
});
