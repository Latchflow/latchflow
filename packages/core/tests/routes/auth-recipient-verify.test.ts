import { describe, it, expect } from "vitest";
import { registerRecipientAuthRoutes } from "../../src/routes/auth/recipient.js";
import type { HttpHandler } from "../../src/http/http-server.js";

describe("recipient verify route", () => {
  it("returns 400 on invalid body", async () => {
    const handlers = new Map<string, HttpHandler>();
    const server = { post: (p: string, h: HttpHandler) => handlers.set(`POST ${p}`, h) } as any;
    const config = {
      AUTH_COOKIE_SECURE: false,
      RECIPIENT_SESSION_TTL_HOURS: 2,
      RECIPIENT_OTP_TTL_MIN: 10,
      RECIPIENT_OTP_LENGTH: 6,
    } as any;
    registerRecipientAuthRoutes(server, config);
    const handler = handlers.get("POST /auth/recipient/verify")!;
    let status = 0;
    let body: any = null;
    await handler({ ip: "1.1.1.1", body: {} } as any, {
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
    });
    expect(status).toBe(400);
    expect(body?.code).toBe("BAD_REQUEST");
  });

  it("is rate-limited after 10 quick calls", async () => {
    const handlers = new Map<string, HttpHandler>();
    const server = { post: (p: string, h: HttpHandler) => handlers.set(`POST ${p}`, h) } as any;
    const config = {
      AUTH_COOKIE_SECURE: false,
      RECIPIENT_SESSION_TTL_HOURS: 2,
      RECIPIENT_OTP_TTL_MIN: 10,
      RECIPIENT_OTP_LENGTH: 6,
    } as any;
    registerRecipientAuthRoutes(server, config);
    const handler = handlers.get("POST /auth/recipient/verify")!;
    for (let i = 0; i < 10; i++) {
      await handler(
        { ip: "3.3.3.3", body: {} } as any,
        {
          status() {
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
      { ip: "3.3.3.3", body: {} } as any,
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
