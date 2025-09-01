import { describe, it, expect } from "vitest";
import { POLICY } from "./policy.js";

describe("authz/policy", () => {
  it("contains expected plugin/capability routes", () => {
    expect(POLICY["GET /plugins"]).toMatchObject({ resource: "plugin", action: "read" });
    expect(POLICY["GET /plugins"].v1AllowExecutor).toBe(true);
    expect(POLICY["GET /capabilities"]).toMatchObject({ resource: "capability", action: "read" });
    expect(POLICY["GET /capabilities"].v1AllowExecutor).toBe(true);
    expect(POLICY["POST /plugins/install"]).toMatchObject({ resource: "plugin", action: "manage" });
    expect(POLICY["DELETE /plugins/:pluginId"]).toMatchObject({
      resource: "plugin",
      action: "delete",
    });
  });
});
