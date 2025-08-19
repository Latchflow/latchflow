import { describe, it, expect, vi } from "vitest";
import { registerAdminAuthRoutes } from "../../../src/routes/auth/admin.js";
import type { HttpHandler } from "../../../src/http/http-server.js";
import { sha256Hex } from "../../../src/auth/tokens.js";

vi.mock("../../../src/db.js", () => {
  return {
    getDb: () => ({
      magicLink: {
        findUnique: vi.fn(async ({ where: { tokenHash } }: any) => ({
          id: "m1",
          userId: "u1",
          tokenHash,
          expiresAt: new Date(Date.now() + 60000),
          consumedAt: null,
        })),
        update: vi.fn(async () => ({})),
      },
      session: {
        create: vi.fn(async () => ({ jti: "sess1" })),
      },
      user: { findUnique: vi.fn(async () => ({ id: "u1", email: "a@b.co", roles: ["ADMIN"] })) },
    }),
  };
});

describe("admin callback success", () => {
  it("sets cookie and redirects when ADMIN_UI_ORIGIN provided", async () => {
    const handlers = new Map<string, HttpHandler>();
    const server = {
      get: (p: string, h: HttpHandler) => handlers.set(`GET ${p}`, h),
      post: () => {},
    } as any;
    const config = {
      AUTH_SESSION_TTL_HOURS: 12,
      AUTH_COOKIE_SECURE: false,
      ADMIN_UI_ORIGIN: "https://admin",
    } as any;
    registerAdminAuthRoutes(server, config);
    const handler = handlers.get("GET /auth/admin/callback")!;
    let code = 0;
    const headers: Record<string, string | string[]> = {};
    let redirected: any[] = [];
    const token = "tok123";
    await handler({ query: { token } } as any, {
      status(c: number) {
        code = c;
        return this as any;
      },
      json() {},
      header(n: string, v: string | string[]) {
        headers[n] = v;
        return this as any;
      },
      redirect(url: string, status?: number) {
        redirected = [url, status];
      },
    });
    expect(code).toBe(0); // redirect path, no json
    expect(redirected[0]).toBe("https://admin");
    expect(String(headers["Set-Cookie"]).includes("lf_admin_sess=sess1")).toBe(true);
  });
});
