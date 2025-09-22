import { describe, it, expect, vi, beforeEach } from "vitest";
import type { HttpHandler, RequestLike } from "../http/http-server.js";
import { createResponseCapture } from "@tests/helpers/response";

vi.mock("../observability/metrics.js", () => ({
  recordAuthzDecision: vi.fn(),
  recordAuthzTwoFactor: vi.fn(),
}));

vi.mock("../authz/authorize.js", () => ({
  authorizeRequest: vi.fn(() => ({
    decision: { ok: true, reason: "RULE_MATCH" },
    rulesHash: "hash",
  })),
}));

vi.mock("../authz/featureFlags.js", () => ({
  getAuthzMode: vi.fn(() => "off"),
  getSystemUserId: vi.fn(() => "system"),
  isAdmin2faRequired: vi.fn(() => false),
  getReauthWindowMs: vi.fn(() => 15 * 60 * 1000),
}));

vi.mock("./require-session.js", () => ({
  requireSession: vi.fn(async (_req: any) => ({
    user: { id: "u1", role: "ADMIN", isActive: true, mfaEnabled: true },
    session: { createdAt: new Date() },
  })),
}));

const mkRes = () => createResponseCapture();

describe("requirePermission (v1)", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const { requireSession } = await import("./require-session.js");
    vi.mocked(requireSession).mockResolvedValue({
      user: { id: "u1", role: "ADMIN", isActive: true, mfaEnabled: true },
      session: { createdAt: new Date() },
    } as any);
    const featureFlags = await import("../authz/featureFlags.js");
    vi.mocked(featureFlags.getAuthzMode).mockReturnValue("off");
    vi.mocked(featureFlags.getSystemUserId).mockReturnValue("system");
    vi.mocked(featureFlags.isAdmin2faRequired).mockReturnValue(false);
    vi.mocked(featureFlags.getReauthWindowMs).mockReturnValue(15 * 60 * 1000);
    const { authorizeRequest } = await import("../authz/authorize.js");
    vi.mocked(authorizeRequest).mockReturnValue({
      decision: { ok: true, reason: "RULE_MATCH" },
      rulesHash: "hash",
    });
  });

  it("allows ADMIN regardless of policy v1AllowExecutor", async () => {
    const { requirePermission } = await import("./require-permission.js");
    const handler: HttpHandler = async (_req, res) => {
      res.status(200).json({ ok: true });
    };
    const wrapped = requirePermission({ action: "delete", resource: "bundle" })(handler);
    const r = mkRes();
    await wrapped({ headers: {} } as RequestLike, r.res);
    expect(r.status).toBe(200);
    expect(r.body?.ok).toBe(true);
  });

  it("denies EXECUTOR unless v1AllowExecutor is true", async () => {
    const { requireSession } = await import("./require-session.js");
    vi.mocked(requireSession).mockResolvedValueOnce({ user: { id: "e1", role: "EXECUTOR" } } as any);
    const { getAuthzMode } = await import("../authz/featureFlags.js");
    vi.mocked(getAuthzMode).mockReturnValueOnce("off");
    const { requirePermission } = await import("./require-permission.js");
    const handler: HttpHandler = async (_req, res) => {
      res.status(200).json({ ok: true });
    };
    const wrapped = requirePermission({ action: "delete", resource: "bundle" })(handler);
    const r = mkRes();
    await expect(wrapped({ headers: {} } as any, r.res)).rejects.toMatchObject({ status: 403 });
  });

  it("allows EXECUTOR when v1AllowExecutor=true (e.g., read)", async () => {
    const { requireSession } = await import("./require-session.js");
    vi.mocked(requireSession).mockResolvedValueOnce({ user: { id: "e1", role: "EXECUTOR" } } as any);
    const { getAuthzMode } = await import("../authz/featureFlags.js");
    vi.mocked(getAuthzMode).mockReturnValueOnce("off");
    const { requirePermission } = await import("./require-permission.js");
    const handler: HttpHandler = async (_req, res) => {
      res.status(200).json({ ok: true });
    };
    const wrapped = requirePermission({
      action: "read",
      resource: "bundle",
      v1AllowExecutor: true,
    })(handler);
    const r = mkRes();
    await wrapped({ headers: {} } as any, r.res);
    expect(r.status).toBe(200);
    expect(r.body?.ok).toBe(true);
  });

  it("logs decision with route signature when provided", async () => {
    const { requireSession } = await import("./require-session.js");
    vi.mocked(requireSession).mockResolvedValueOnce({ user: { id: "a1", role: "ADMIN" } } as any);
    const { getAuthzMode } = await import("../authz/featureFlags.js");
    vi.mocked(getAuthzMode).mockReturnValueOnce("off");
    const spy = vi.spyOn(console, "info").mockImplementation(() => {});
    const { requirePermission } = await import("./require-permission.js");
    const handler: HttpHandler = async (_req, res) => {
      res.status(200).json({ ok: true });
    };
    const wrapped = requirePermission("GET /plugins")(handler);
    const r = mkRes();
    await wrapped({ headers: {} } as any, r.res);
    expect(r.status).toBe(200);
    const arg = (spy.mock.calls[0]?.[0] as string) ?? "{}";
    const obj = JSON.parse(arg);
    expect(obj.kind).toBe("authz_decision");
    expect(obj.signature).toBe("GET /plugins");
    spy.mockRestore();
  });

  it("enforces new authz in enforce mode", async () => {
    const { getAuthzMode } = await import("../authz/featureFlags.js");
    vi.mocked(getAuthzMode).mockReturnValueOnce("enforce");
    const { authorizeRequest } = await import("../authz/authorize.js");
    vi.mocked(authorizeRequest).mockReturnValueOnce({
      decision: { ok: false, reason: "NO_MATCH" },
      rulesHash: "hash",
    });
    const { requirePermission } = await import("./require-permission.js");
    const handler: HttpHandler = async (_req, res) => {
      res.status(200).json({ ok: true });
    };
    const wrapped = requirePermission({ action: "delete", resource: "bundle" })(handler);
    const r = mkRes();
    await expect(wrapped({ headers: {} } as any, r.res)).rejects.toMatchObject({ status: 403 });
  });

  it("falls back to legacy in shadow mode after recording metrics", async () => {
    const { getAuthzMode } = await import("../authz/featureFlags.js");
    vi.mocked(getAuthzMode).mockReturnValueOnce("shadow");
    const { authorizeRequest } = await import("../authz/authorize.js");
    vi.mocked(authorizeRequest).mockReturnValueOnce({
      decision: { ok: false, reason: "NO_MATCH" },
      rulesHash: "hash",
    });
    const metrics = await import("../observability/metrics.js");
    const recordSpy = vi.mocked(metrics.recordAuthzDecision);
    const { requirePermission } = await import("./require-permission.js");
    const handler: HttpHandler = async (_req, res) => {
      res.status(200).json({ ok: true });
    };
    const wrapped = requirePermission({ action: "read", resource: "bundle", v1AllowExecutor: true })(handler);
    const r = mkRes();
    await wrapped({ headers: {} } as any, r.res);
    expect(recordSpy).toHaveBeenCalled();
    expect(r.status).toBe(200);
  });

  it("requires 2FA for enforce mode when enabled", async () => {
    const { getAuthzMode, isAdmin2faRequired } = await import("../authz/featureFlags.js");
    vi.mocked(getAuthzMode).mockReturnValueOnce("enforce");
    vi.mocked(isAdmin2faRequired).mockReturnValueOnce(true);
    const { authorizeRequest } = await import("../authz/authorize.js");
    vi.mocked(authorizeRequest).mockReturnValueOnce({
      decision: { ok: true, reason: "RULE_MATCH" },
      rulesHash: "hash",
    });
    const { requireSession } = await import("./require-session.js");
    vi.mocked(requireSession).mockResolvedValueOnce({
      user: { id: "admin", role: "ADMIN", mfaEnabled: false },
      session: { createdAt: new Date() },
    } as any);
    const { requirePermission } = await import("./require-permission.js");
    const handler: HttpHandler = async (_req, res) => {
      res.status(200).json({ ok: true });
    };
    const wrapped = requirePermission({ action: "update", resource: "bundle" })(handler);
    const r = mkRes();
    await expect(wrapped({ headers: {} } as any, r.res)).rejects.toMatchObject({ status: 401 });
  });
});
