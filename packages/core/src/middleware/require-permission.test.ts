import { describe, it, expect, vi, beforeEach } from "vitest";
import type { HttpHandler, RequestLike } from "../http/http-server.js";
import { createResponseCapture } from "@tests/helpers/response";

vi.mock("./require-session.js", () => ({
  requireSession: vi.fn(async (_req: any) => ({ user: { id: "u1", role: "ADMIN" } })),
}));

const mkRes = () => createResponseCapture();

describe("requirePermission (v1)", () => {
  beforeEach(() => {
    vi.resetModules();
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
    vi.doMock("./require-session.js", () => ({
      requireSession: vi.fn(async () => ({ user: { id: "e1", role: "EXECUTOR" } })),
    }));
    const { requirePermission } = await import("./require-permission.js");
    const handler: HttpHandler = async (_req, res) => {
      res.status(200).json({ ok: true });
    };
    const wrapped = requirePermission({ action: "delete", resource: "bundle" })(handler);
    const r = mkRes();
    await expect(wrapped({ headers: {} } as any, r.res)).rejects.toMatchObject({ status: 403 });
  });

  it("allows EXECUTOR when v1AllowExecutor=true (e.g., read)", async () => {
    vi.doMock("./require-session.js", () => ({
      requireSession: vi.fn(async () => ({ user: { id: "e1", role: "EXECUTOR" } })),
    }));
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
    vi.doMock("./require-session.js", () => ({
      requireSession: vi.fn(async () => ({ user: { id: "a1", role: "ADMIN", roles: ["ADMIN"] } })),
    }));
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
});
