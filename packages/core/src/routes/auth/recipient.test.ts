import { describe, it, expect, vi } from "vitest";
import { registerRecipientAuthRoutes } from "./recipient.js";
import type { HttpHandler } from "../../http/http-server.js";
import { sha256Hex } from "../../auth/tokens.js";

const db = {
  recipient: { findUnique: vi.fn(async (): Promise<any> => null) },
  recipientOtp: {
    deleteMany: vi.fn(async (): Promise<any> => {}),
    create: vi.fn(async (): Promise<any> => ({})),
    findFirst: vi.fn(async (): Promise<any> => null),
    update: vi.fn(async (): Promise<any> => ({})),
    delete: vi.fn(async (): Promise<any> => ({})),
  },
  recipientSession: {
    create: vi.fn(async (): Promise<any> => ({ jti: "rs1" })),
    findUnique: vi.fn(async (): Promise<any> => null),
    updateMany: vi.fn(async (): Promise<any> => ({})),
  },
};

vi.mock("../../db/db.js", () => ({ getDb: () => db }));

function makeServer() {
  const handlers = new Map<string, HttpHandler>();
  const server = {
    post: (p: string, h: HttpHandler) => handlers.set(`POST ${p}`, h),
    get: (_p: string, _h: HttpHandler) => {},
  } as any;
  const config = {
    AUTH_COOKIE_SECURE: false,
    RECIPIENT_OTP_LENGTH: 6,
    RECIPIENT_OTP_TTL_MIN: 10,
    RECIPIENT_SESSION_TTL_HOURS: 2,
  } as any;
  registerRecipientAuthRoutes(server, config);
  return { handlers };
}

describe("recipient auth routes", () => {
  it("/auth/recipient/start 404 when recipient not found", async () => {
    db.recipient.findUnique.mockResolvedValueOnce(null);
    const { handlers } = makeServer();
    const h = handlers.get("POST /auth/recipient/start")!;
    let status = 0;
    let body: any = null;
    await h({ ip: "1.1.1.1", body: { recipientId: "r" } } as any, {
      status(c: number) {
        status = c;
        return this as any;
      },
      json(p: unknown) {
        body = p;
      },
      header() {
        return this as any;
      },
      redirect() {},
      sendStream() {},
      sendBuffer() {},
    });
    expect(status).toBe(404);
    expect((body as any)?.code).toBe("NOT_FOUND");
  });

  it("/auth/recipient/start is rate-limited after 10 calls per minute", async () => {
    db.recipient.findUnique.mockResolvedValue({ id: "r" } as any);
    const { handlers } = makeServer();
    const h = handlers.get("POST /auth/recipient/start")!;
    for (let i = 0; i < 10; i++) {
      await h(
        { ip: "2.2.2.2", body: { recipientId: "r" } } as any,
        {
          status() {
            return this as any;
          },
          json() {},
          header() {
            return this as any;
          },
          redirect() {},
          sendStream() {},
          sendBuffer() {},
        } as any,
      );
    }
    let status = 0;
    let body: any = null;
    await h(
      { ip: "2.2.2.2", body: { recipientId: "r" } } as any,
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

  it("/auth/recipient/verify returns 400 on invalid body", async () => {
    const { handlers } = makeServer();
    const h = handlers.get("POST /auth/recipient/verify")!;
    let status = 0;
    let body: any = null;
    await h({ ip: "3.3.3.3", body: {} } as any, {
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
      sendStream() {},
      sendBuffer() {},
    });
    expect(status).toBe(400);
    expect(body?.code).toBe("BAD_REQUEST");
  });

  it("/auth/recipient/verify is rate-limited after 10 quick calls", async () => {
    const { handlers } = makeServer();
    const h = handlers.get("POST /auth/recipient/verify")!;
    for (let i = 0; i < 10; i++) {
      await h(
        { ip: "4.4.4.4", body: { recipientId: "r", otp: "000000" } } as any,
        {
          status() {
            return this as any;
          },
          json() {},
          header() {
            return this as any;
          },
          redirect() {},
          sendStream() {},
          sendBuffer() {},
        } as any,
      );
    }
    let status = 0;
    let body: any = null;
    await h(
      { ip: "4.4.4.4", body: { recipientId: "r", otp: "000000" } } as any,
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

  it("success flow: start returns 204 when recipient exists; verify sets cookie", async () => {
    // Recipient exists
    db.recipient.findUnique.mockResolvedValueOnce({ id: "r" } as any);
    // OTP will exist and match
    db.recipientOtp.findFirst.mockResolvedValueOnce({
      id: "o1",
      codeHash: sha256Hex("123456"),
      attempts: 0,
      expiresAt: new Date(Date.now() + 60000),
    } as any);

    const { handlers } = makeServer();
    const start = handlers.get("POST /auth/recipient/start")!;
    let code = 0;
    await start({ ip: "1.1.1.1", body: { recipientId: "r" } } as any, {
      status(c: number) {
        code = c;
        return this as any;
      },
      json() {},
      header() {
        return this as any;
      },
      redirect() {},
      sendStream() {},
      sendBuffer() {},
    });
    expect(code).toBe(204);

    const verify = handlers.get("POST /auth/recipient/verify")!;
    // recipient lookup during verify
    db.recipient.findUnique.mockResolvedValueOnce({ id: "r" } as any);
    const headers: Record<string, string | string[]> = {};
    code = 0;
    await verify(
      { ip: "1.1.1.1", body: { recipientId: "r", otp: "123456" } } as any,
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
      } as any,
    );
    expect(code).toBe(204);
    expect(String(headers["Set-Cookie"]).includes("lf_recipient_sess=rs1")).toBe(true);
  });

  it("/auth/recipient/logout is idempotent without session cookie (204 + clear)", async () => {
    const { handlers } = makeServer();
    const h = handlers.get("POST /auth/recipient/logout")!;
    let status = 0;
    const headers: Record<string, string | string[]> = {};
    await h({ headers: {} } as any, {
      status(c: number) {
        status = c;
        return this as any;
      },
      json() {},
      header(n: string, v: string | string[]) {
        headers[n] = v;
        return this as any;
      },
      redirect() {},
      sendStream() {},
      sendBuffer() {},
    });
    expect(status).toBe(204);
    expect(String(headers["Set-Cookie"]).includes("Max-Age=0")).toBe(true);
  });

  it("/auth/recipient/logout revokes session and clears cookie when authenticated", async () => {
    const { handlers } = makeServer();
    const h = handlers.get("POST /auth/recipient/logout")!;
    let status = 0;
    const headers: Record<string, string | string[]> = {};
    await h({ headers: { cookie: "lf_recipient_sess=rs1" } } as any, {
      status(c: number) {
        status = c;
        return this as any;
      },
      json() {},
      header(n: string, v: string | string[]) {
        headers[n] = v;
        return this as any;
      },
      redirect() {},
      sendStream() {},
      sendBuffer() {},
    });
    expect(status).toBe(204);
    expect(String(headers["Set-Cookie"]).includes("Max-Age=0")).toBe(true);
    expect(db.recipientSession.updateMany).toHaveBeenCalled();
  });

  it("/portal/auth/otp/resend returns 400 on invalid body", async () => {
    const { handlers } = makeServer();
    const h = handlers.get("POST /portal/auth/otp/resend")!;
    let status = 0;
    let body: any = null;
    await h({ ip: "9.9.9.9", body: {} } as any, {
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
      sendStream() {},
      sendBuffer() {},
    });
    expect(status).toBe(400);
    expect(body?.code).toBe("BAD_REQUEST");
  });

  it("/portal/auth/otp/resend returns 204 even when recipient not found", async () => {
    db.recipient.findUnique.mockResolvedValueOnce(null);
    const { handlers } = makeServer();
    const h = handlers.get("POST /portal/auth/otp/resend")!;
    const beforeDeleteCalls = db.recipientOtp.deleteMany.mock.calls.length;
    const beforeCreateCalls = db.recipientOtp.create.mock.calls.length;
    let status = 0;
    await h({ ip: "8.8.8.8", body: { recipientId: "r" } } as any, {
      status(c: number) {
        status = c;
        return this as any;
      },
      json() {},
      header() {
        return this as any;
      },
      redirect() {},
      sendStream() {},
      sendBuffer() {},
    });
    expect(status).toBe(204);
    expect(db.recipientOtp.deleteMany.mock.calls.length).toBe(beforeDeleteCalls);
    expect(db.recipientOtp.create.mock.calls.length).toBe(beforeCreateCalls);
  });

  it("/portal/auth/otp/resend returns 204 when recipient exists by id", async () => {
    db.recipient.findUnique.mockResolvedValueOnce({ id: "r", isEnabled: true } as any);
    const { handlers } = makeServer();
    const h = handlers.get("POST /portal/auth/otp/resend")!;
    let status = 0;
    await h({ ip: "7.7.7.7", body: { recipientId: "r" } } as any, {
      status(c: number) {
        status = c;
        return this as any;
      },
      json() {},
      header() {
        return this as any;
      },
      redirect() {},
      sendStream() {},
      sendBuffer() {},
    });
    expect(status).toBe(204);
  });

  it("/portal/auth/otp/resend returns 204 when recipient exists by email", async () => {
    db.recipient.findUnique.mockResolvedValueOnce({ id: "r", isEnabled: true } as any);
    const { handlers } = makeServer();
    const h = handlers.get("POST /portal/auth/otp/resend")!;
    let status = 0;
    await h({ ip: "6.6.6.6", body: { email: "user@example.com" } } as any, {
      status(c: number) {
        status = c;
        return this as any;
      },
      json() {},
      header() {
        return this as any;
      },
      redirect() {},
      sendStream() {},
      sendBuffer() {},
    });
    expect(status).toBe(204);
  });

  it("/portal/auth/otp/resend is rate-limited after 10 calls per minute", async () => {
    // Note: rate limit key is subject; use same subject each time.
    db.recipient.findUnique.mockResolvedValue({ id: "r", isEnabled: true } as any);
    const { handlers } = makeServer();
    const h = handlers.get("POST /portal/auth/otp/resend")!;
    for (let i = 0; i < 10; i++) {
      await h(
        { ip: "5.5.5.5", body: { recipientId: "r" } } as any,
        {
          status() {
            return this as any;
          },
          json() {},
          header() {
            return this as any;
          },
          redirect() {},
          sendStream() {},
          sendBuffer() {},
        } as any,
      );
    }
    let status = 0;
    let body: any = null;
    await h(
      { ip: "5.5.5.5", body: { recipientId: "r" } } as any,
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
