import { describe, it, expect } from "vitest";
import { registerRecipientAdminRoutes } from "../../../src/routes/admin/recipients.js";
import type { HttpHandler } from "../../../src/http/http-server.js";

describe("admin recipients route", () => {
  it("returns 501 not implemented", async () => {
    const handlers = new Map<string, HttpHandler>();
    const server = { get: (p: string, h: HttpHandler) => handlers.set(`GET ${p}`, h) } as any;
    registerRecipientAdminRoutes(server);
    const h = handlers.get("GET /admin/recipients")!;
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
    });
    expect(status).toBe(501);
    expect(body?.code).toBe("NOT_IMPLEMENTED");
  });
});
