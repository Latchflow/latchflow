import { describe, it, expect, vi } from "vitest";
import { registerRecipientAuthRoutes } from "../../../src/routes/auth/recipient.js";
import type { HttpHandler } from "../../../src/http/http-server.js";
import { sha256Hex } from "../../../src/auth/tokens.js";

vi.mock("../../../src/db.js", () => {
  const assignment = { findFirst: vi.fn(async () => ({ id: "as1" })) };
  const otp = {
    deleteMany: vi.fn(async () => {}),
    create: vi.fn(async () => ({})),
    findFirst: vi.fn(async () => ({
      id: "o1",
      codeHash: sha256Hex("123456"),
      attempts: 0,
      expiresAt: new Date(Date.now() + 60000),
    })),
    update: vi.fn(async () => ({})),
    delete: vi.fn(async () => ({})),
  };
  const session = {
    create: vi.fn(async () => ({ jti: "rs1" })),
    updateMany: vi.fn(async () => ({})),
  };
  return {
    getDb: () => ({ bundleAssignment: assignment, recipientOtp: otp, recipientSession: session }),
  };
});

describe("recipient auth success flow", () => {
  it("start returns 204 when assigned; verify sets cookie", async () => {
    const handlers = new Map<string, HttpHandler>();
    const server = {
      post: (p: string, h: HttpHandler) => handlers.set(`POST ${p}`, h),
    } as any;
    const config = {
      AUTH_COOKIE_SECURE: false,
      RECIPIENT_OTP_LENGTH: 6,
      RECIPIENT_OTP_TTL_MIN: 10,
      RECIPIENT_SESSION_TTL_HOURS: 2,
    } as any;
    registerRecipientAuthRoutes(server, config);
    const start = handlers.get("POST /auth/recipient/start")!;
    let code = 0;
    await start({ ip: "1.1.1.1", body: { recipientId: "r", bundleId: "b" } } as any, {
      status(c: number) {
        code = c;
        return this as any;
      },
      json() {},
      header() {
        return this as any;
      },
      redirect() {},
    });
    expect(code).toBe(204);
    const verify = handlers.get("POST /auth/recipient/verify")!;
    const headers: Record<string, string | string[]> = {};
    code = 0;
    await verify(
      { ip: "1.1.1.1", body: { recipientId: "r", bundleId: "b", otp: "123456" } } as any,
      {
        status(c: number) {
          code = c;
          return this as any;
        },
        json() {},
        header(n: string, v: string | string[]) {
          headers[n] = v;
          return this as any;
        },
        redirect() {},
      },
    );
    expect(code).toBe(204);
    expect(String(headers["Set-Cookie"]).includes("lf_recipient_sess=rs1")).toBe(true);
  });
});
