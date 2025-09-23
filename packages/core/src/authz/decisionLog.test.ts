import { describe, it, expect, vi } from "vitest";

// Mock the logger before importing anything that uses it
const mockLogger = {
  info: vi.fn(),
};

vi.mock("../observability/logger.js", () => ({
  createAuthzLogger: () => mockLogger,
}));

import { logDecision } from "./decisionLog.js";

describe("authz/decisionLog", () => {
  it("emits a JSON line with expected fields", () => {
    mockLogger.info.mockClear();

    logDecision({
      decision: "ALLOW",
      reason: "ADMIN",
      userId: "u1",
      action: "read",
      resource: "plugin",
    });

    expect(mockLogger.info).toHaveBeenCalledOnce();
    const call = mockLogger.info.mock.calls[0];
    const logData = call[0];
    const logMessage = call[1];
    expect(logData.kind).toBe("authz_decision");
    expect(logData.decision).toBe("ALLOW");
    expect(logData.reason).toBe("ADMIN");
    expect(logData.userId).toBe("u1");
    expect(logMessage).toBe("Authorization decision");
  });
});
