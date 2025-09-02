import { describe, it, expect, vi, beforeEach } from "vitest";
import type { HttpHandler, RequestLike, ResponseLike } from "../http/http-server.js";

// Use the prisma mock via direct import (same instance as alias target)
import { prisma } from "../test/prisma-mock.js";

// Mock require-session used by requirePermission so cookie path works in tests
vi.mock("./require-session.js", () => ({
  requireSession: vi.fn(async () => ({ user: { id: "u-admin", role: "ADMIN", isActive: true } })),
}));
import { requireSession } from "./require-session.js";

// Use real requirePermission and requireApiToken (which see prisma mock via alias)
import { requireAdminOrApiToken } from "./require-admin-or-api-token.js";

function makeResCapture() {
  let statusCode = 0;
  let jsonBody: any = undefined;
  const res: ResponseLike = {
    status(c: number) {
      statusCode = c;
      return this;
    },
    json(p: any) {
      jsonBody = p;
    },
    header() {
      return this;
    },
    redirect() {},
    sendStream() {},
    sendBuffer() {},
  };
  return {
    res,
    get status() {
      return statusCode;
    },
    get body() {
      return jsonBody;
    },
  };
}

describe("requireAdminOrApiToken", () => {
  beforeEach(() => {
    // reset prisma mocks
    Object.values(prisma).forEach((model: any) => {
      if (model && model.findUnique?.mockReset) model.findUnique.mockReset();
      if (model && model.update?.mockReset) model.update.mockReset();
    });
    // reset requireSession mock implementation and calls
    if ((requireSession as any).mockReset) (requireSession as any).mockReset();
    if ((requireSession as any).mockClear) (requireSession as any).mockClear();
    (requireSession as any).mockResolvedValue({
      user: { id: "u-admin", role: "ADMIN", isActive: true },
    });
  });

  it("allows bearer token with required scope", async () => {
    const token = {
      id: "t1",
      scopes: ["core:read"],
      revokedAt: null,
      expiresAt: new Date(Date.now() + 3600_000),
      user: { id: "u1", email: "u1@example.com", isActive: true },
    } as any;
    (prisma.apiToken.findUnique as any).mockResolvedValueOnce(token);
    (prisma.apiToken.update as any).mockResolvedValueOnce({});

    let called = false;
    const handler: HttpHandler = async (_req, res) => {
      called = true;
      res.status(200).json({ ok: true });
    };
    const wrapped = requireAdminOrApiToken({
      policySignature: "GET /plugins",
      scopes: ["core:read"],
    })(handler);

    const req: RequestLike = {
      headers: { authorization: "Bearer abc" },
    };
    const rc = makeResCapture();
    await wrapped(req, rc.res);
    expect(called).toBe(true);
    expect(rc.status).toBe(200);
    expect(rc.body).toEqual({ ok: true });
  });

  it("rejects bearer token missing required scope (403)", async () => {
    const token = {
      id: "t1",
      scopes: ["core:read"],
      revokedAt: null,
      expiresAt: new Date(Date.now() + 3600_000),
      user: { id: "u1", email: "u1@example.com", isActive: true },
    } as any;
    (prisma.apiToken.findUnique as any).mockResolvedValueOnce(token);
    (prisma.apiToken.update as any).mockResolvedValueOnce({});

    const handler: HttpHandler = async (_req, _res) => {
      // should not run
      throw new Error("handler should not be called");
    };
    const wrapped = requireAdminOrApiToken({
      policySignature: "POST /plugins/install",
      scopes: ["core:write"],
    })(handler);

    const req: RequestLike = { headers: { authorization: "Bearer abc" } };
    const rc = makeResCapture();
    let err: any = null;
    try {
      await wrapped(req, rc.res);
    } catch (e) {
      err = e;
    }
    expect(err).toBeTruthy();
    expect((err as any).status).toBe(403);
  });

  it("rejects bearer token when revoked (401)", async () => {
    const token = {
      id: "t1",
      scopes: ["core:read", "core:write"],
      revokedAt: new Date(),
      expiresAt: new Date(Date.now() + 3600_000),
      user: { id: "u1", email: "u1@example.com", isActive: true },
    } as any;
    (prisma.apiToken.findUnique as any).mockResolvedValueOnce(token);

    const handler: HttpHandler = async (_req, _res) => {
      throw new Error("handler should not be called");
    };
    const wrapped = requireAdminOrApiToken({
      policySignature: "GET /plugins",
      scopes: ["core:read"],
    })(handler);

    const req: RequestLike = { headers: { authorization: "Bearer abc" } };
    const rc = makeResCapture();
    let err: any;
    try {
      await wrapped(req, rc.res);
    } catch (e) {
      err = e;
    }
    expect(err).toBeTruthy();
    expect((err as any).status).toBe(401);
  });

  it("rejects bearer token when expired (401)", async () => {
    const token = {
      id: "t1",
      scopes: ["core:read"],
      revokedAt: null,
      expiresAt: new Date(Date.now() - 1000),
      user: { id: "u1", email: "u1@example.com", isActive: true },
    } as any;
    (prisma.apiToken.findUnique as any).mockResolvedValueOnce(token);

    const handler: HttpHandler = async (_req, _res) => {
      throw new Error("handler should not be called");
    };
    const wrapped = requireAdminOrApiToken({
      policySignature: "GET /plugins",
      scopes: ["core:read"],
    })(handler);
    const req: RequestLike = { headers: { authorization: "Bearer abc" } };
    const rc = makeResCapture();
    let err: any;
    try {
      await wrapped(req, rc.res);
    } catch (e) {
      err = e;
    }
    expect(err).toBeTruthy();
    expect((err as any).status).toBe(401);
  });

  it("blocks executor via cookie on admin-only route (403)", async () => {
    // Force cookie path by omitting Authorization header
    (requireSession as any).mockResolvedValueOnce({
      user: { id: "u-exec", role: "EXECUTOR", isActive: true },
    });
    const handler: HttpHandler = async (_req, _res) => {
      throw new Error("handler should not be called");
    };
    const wrapped = requireAdminOrApiToken({
      policySignature: "POST /plugins/install",
      scopes: ["core:write"],
    })(handler);
    const req: RequestLike = { headers: {} } as any;
    const rc = makeResCapture();
    let err: any;
    try {
      await wrapped(req, rc.res);
    } catch (e) {
      err = e;
    }
    expect(err).toBeTruthy();
    expect((err as any).status).toBe(403);
  });

  it("uses bearer path when Authorization present (no cookie needed)", async () => {
    (prisma.apiToken.findUnique as any).mockResolvedValueOnce({
      id: "t1",
      scopes: ["core:read"],
      revokedAt: null,
      expiresAt: new Date(Date.now() + 3600_000),
      user: { id: "u1", email: "u1@example.com", isActive: true },
    } as any);
    (prisma.apiToken.update as any).mockResolvedValueOnce({});
    let called = false;
    const handler: HttpHandler = async (_req, res) => {
      called = true;
      res.status(200).json({ ok: true });
    };
    const wrapped = requireAdminOrApiToken({
      policySignature: "GET /plugins",
      scopes: ["core:read"],
    })(handler);
    const req: RequestLike = { headers: { authorization: "Bearer abc" } };
    const rc = makeResCapture();
    await wrapped(req, rc.res);
    expect(called).toBe(true);
    expect(rc.status).toBe(200);
    // should not hit cookie path
    expect((requireSession as any).mock.calls.length).toBe(0);
  });

  it("does not fall back to cookie when bearer fails (no requireSession call)", async () => {
    // Token lookup returns null -> invalid token
    (prisma.apiToken.findUnique as any).mockResolvedValueOnce(null);
    const handler: HttpHandler = async (_req, _res) => {
      throw new Error("handler should not be called");
    };
    const wrapped = requireAdminOrApiToken({
      policySignature: "GET /plugins",
      scopes: ["core:read"],
    })(handler);
    const req: RequestLike = { headers: { authorization: "Bearer abc" } };
    const rc = makeResCapture();
    let err: any;
    try {
      await wrapped(req, rc.res);
    } catch (e) {
      err = e;
    }
    expect(err).toBeTruthy();
    // Ensure we didn't attempt cookie fallback
    expect((requireSession as any).mock.calls.length).toBe(0);
  });

  it("falls back to admin cookie path when no Authorization header", async () => {
    let called = false;
    const handler: HttpHandler = async (_req, res) => {
      called = true;
      res.status(200).json({ ok: true });
    };
    const wrapped = requireAdminOrApiToken({
      policySignature: "GET /plugins",
      scopes: ["core:read"],
    })(handler);
    const req: RequestLike = {
      headers: {
        /* no auth */
      },
    };
    const rc = makeResCapture();
    await wrapped(req, rc.res);
    expect(called).toBe(true);
    expect(rc.status).toBe(200);
  });
});
