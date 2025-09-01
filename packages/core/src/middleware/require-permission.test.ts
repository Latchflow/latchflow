import { describe, it, expect, vi, beforeEach } from "vitest";
import type { HttpHandler, RequestLike, ResponseLike } from "../http/http-server.js";

vi.mock("./require-session.js", () => ({
  requireSession: vi.fn(async (_req: any) => ({ user: { id: "u1", role: "ADMIN" } })),
}));

function mkRes() {
  let statusCode = 200;
  let payload: any = null;
  const res: ResponseLike = {
    status(c: number) {
      statusCode = c;
      return this;
    },
    json(p: any) {
      payload = p;
    },
    header() {
      return this;
    },
    redirect() {},
  };
  return {
    res,
    get status() {
      return statusCode;
    },
    get body() {
      return payload;
    },
  };
}

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
});
