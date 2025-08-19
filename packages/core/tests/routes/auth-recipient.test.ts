import { describe, it, expect, vi } from "vitest";
import { registerRecipientAuthRoutes } from "../../src/routes/auth/recipient.js";
import type { HttpHandler } from "../../src/http/http-server.js";

vi.mock("../../src/db.js", () => {
  return {
    getDb: () => ({
      bundleAssignment: { findFirst: vi.fn(async () => null) },
      recipientOtp: {
        deleteMany: vi.fn(),
        create: vi.fn(),
        findFirst: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
      },
      recipientSession: { create: vi.fn(), updateMany: vi.fn() },
    }),
  };
});

describe("recipient auth routes", () => {
  it("/auth/recipient/start 404 when not assigned", async () => {
    const handlers = new Map<string, HttpHandler>();
    const server = {
      post: (p: string, h: HttpHandler) => handlers.set(`POST ${p}`, h),
    } as any;
    const config = {
      RECIPIENT_OTP_LENGTH: 6,
      RECIPIENT_OTP_TTL_MIN: 10,
      AUTH_COOKIE_SECURE: false,
    } as any;
    registerRecipientAuthRoutes(server, config);
    const handler = handlers.get("POST /auth/recipient/start")!;
    let status = 0;
    let json: any = null;
    await handler({ ip: "1.1.1.1", body: { recipientId: "r", bundleId: "b" } } as any, {
      status(c: number) {
        status = c;
        return this as any;
      },
      json(p: unknown) {
        json = p;
      },
      header() {
        return this as any;
      },
      redirect() {},
    });
    expect(status).toBe(404);
    expect(json?.code).toBe("NOT_FOUND");
  });

  it("/auth/recipient/start is rate-limited after 10 calls per minute", async () => {
    const handlers = new Map<string, HttpHandler>();
    const server = {
      post: (p: string, h: HttpHandler) => handlers.set(`POST ${p}`, h),
    } as any;
    const config = {
      RECIPIENT_OTP_LENGTH: 6,
      RECIPIENT_OTP_TTL_MIN: 10,
      AUTH_COOKIE_SECURE: false,
    } as any;
    registerRecipientAuthRoutes(server, config);
    const handler = handlers.get("POST /auth/recipient/start")!;
    // 10 calls ok (404 each), 11th should be 429
    for (let i = 0; i < 10; i++) {
      let status = 0;
      await handler(
        { ip: "2.2.2.2", body: { recipientId: "r", bundleId: "b" } } as any,
        {
          status(c: number) {
            status = c;
            return this as any;
          },
          json() {},
          header() {
            return this as any;
          },
          redirect() {},
        } as any,
      );
    }
    let status = 0;
    let body: any = null;
    await handler(
      { ip: "2.2.2.2", body: { recipientId: "r", bundleId: "b" } } as any,
      {
        status(c: number) {
          status = c;
          return this as any;
        },
        json(p: any) {
          body = p;
        },
        header() {
          return this as any;
        },
        redirect() {},
      } as any,
    );
    expect(status).toBe(429);
    expect(body?.code).toBe("RATE_LIMITED");
  });
});
