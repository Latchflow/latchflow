import { describe, it, expect } from "vitest";
import { registerCliAuthRoutes } from "../../src/routes/auth/cli.js";
import type { HttpHandler } from "../../src/http/http-server.js";

describe("cli poll route", () => {
  it("returns 400 on invalid body", async () => {
    const handlers = new Map<string, HttpHandler>();
    const server = {
      post: (p: string, h: HttpHandler) => handlers.set(`POST ${p}`, h),
      get: (_p: string, _h: HttpHandler) => {},
    } as any;
    const config = {
      DEVICE_CODE_TTL_MIN: 10,
      DEVICE_CODE_INTERVAL_SEC: 5,
      API_TOKEN_SCOPES_DEFAULT: ["core:read"],
      API_TOKEN_PREFIX: "lfk_",
    } as any;
    registerCliAuthRoutes(server, config);
    const handler = handlers.get("POST /auth/cli/device/poll")!;
    let status = 0;
    let body: any = null;
    await handler({ ip: "2.2.2.2", body: {} } as any, {
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
});
