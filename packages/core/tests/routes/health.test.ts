import { describe, it, expect } from "vitest";
import { registerHealthRoutes } from "../../src/routes/health.js";
import type { HttpHandler } from "../../src/http/http-server.js";

describe("health route", () => {
  it("returns ok status and details", async () => {
    const handlers = new Map<string, HttpHandler>();
    const server = {
      get: (p: string, h: HttpHandler) => handlers.set(`GET ${p}`, h),
    } as any;
    registerHealthRoutes(server, { queueName: "memory", storageName: "fs" });
    const handler = handlers.get("GET /health")!;
    let status = 0;
    let json: any;
    await handler({} as any, {
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
    expect(status).toBe(200);
    expect(json).toEqual({ status: "ok", queue: "memory", storage: "fs" });
  });
});
