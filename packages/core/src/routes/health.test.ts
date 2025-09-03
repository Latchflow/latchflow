import { describe, it, expect } from "vitest";
import { registerHealthRoutes } from "../routes/health.js";
import type { HttpHandler } from "../http/http-server.js";

describe("health routes", () => {
  it("GET /health returns ok status and details", async () => {
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
      sendStream() {},
      sendBuffer() {},
    });
    expect(status).toBe(200);
    expect(json).toEqual({ status: "ok", queue: "memory", storage: "fs" });
  });

  it("GET /health/live responds 200", async () => {
    const handlers = new Map<string, HttpHandler>();
    const server = {
      get: (p: string, h: HttpHandler) => handlers.set(`GET ${p}`, h),
    } as any;
    registerHealthRoutes(server, { queueName: "memory", storageName: "fs" });
    const handler = handlers.get("GET /health/live");
    if (!handler) throw new Error("/health/live not registered");

    let status = 0;
    await handler({} as any, {
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
    expect(status).toBe(200);
  });

  it("GET /health/ready responds 200 when all checks pass", async () => {
    const handlers = new Map<string, HttpHandler>();
    const server = {
      get: (p: string, h: HttpHandler) => handlers.set(`GET ${p}`, h),
    } as any;
    registerHealthRoutes(server, {
      queueName: "memory",
      storageName: "fs",
      checkDb: async () => void 0,
      checkQueue: async () => void 0,
      checkStorage: async () => void 0,
    });
    const handler = handlers.get("GET /health/ready");
    if (!handler) throw new Error("/health/ready not registered");

    let status = 0;
    let json: any;
    await handler({} as any, {
      status(c: number) {
        status = c;
        return this as any;
      },
      json(p: any) {
        json = p;
      },
      header() {
        return this as any;
      },
      redirect() {},
      sendStream() {},
      sendBuffer() {},
    });
    expect(status).toBe(200);
    expect(json?.status).toBe("ready");
    expect(json?.components).toEqual({ db: "ok", queue: "ok", storage: "ok" });
  });

  it("GET /health/ready responds 503 when a check fails", async () => {
    const handlers = new Map<string, HttpHandler>();
    const server = {
      get: (p: string, h: HttpHandler) => handlers.set(`GET ${p}`, h),
    } as any;
    registerHealthRoutes(server, {
      queueName: "memory",
      storageName: "fs",
      checkDb: async () => {
        throw new Error("db down");
      },
    });
    const handler = handlers.get("GET /health/ready");
    if (!handler) throw new Error("/health/ready not registered");

    let status = 0;
    let body: any;
    await handler({} as any, {
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
    expect(status).toBe(503);
    expect(body?.code).toBe("NOT_READY");
    expect(body?.components?.db).toBe("error");
  });
});
