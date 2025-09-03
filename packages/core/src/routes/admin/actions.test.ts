import { describe, it, expect } from "vitest";
import { registerActionAdminRoutes } from "../../routes/admin/actions.js";
import type { HttpHandler } from "../../http/http-server.js";

describe("admin actions route", () => {
  it("returns 501 not implemented", async () => {
    const handlers = new Map<string, HttpHandler>();
    const server = { get: (p: string, h: HttpHandler) => handlers.set(`GET ${p}`, h) } as any;
    registerActionAdminRoutes(server);
    const h = handlers.get("GET /admin/actions")!;
    let status = 0;
    let body: any = null;
    await h({} as any, {
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
    expect(status).toBe(501);
    expect(body?.code).toBe("NOT_IMPLEMENTED");
  });
});
