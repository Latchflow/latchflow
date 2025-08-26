import { describe, it, expect, vi } from "vitest";

// Mock express and middlewares to capture wrap behaviour
const appState: any = { routes: [], errorHandler: null };
vi.mock("express", () => {
  const app = {
    use(fn: any) {
      if (typeof fn === "function" && fn.length === 4) appState.errorHandler = fn;
    },
    get(_p: string, h: any) {
      appState.routes.push({ m: "GET", h });
    },
    post(_p: string, h: any) {
      appState.routes.push({ m: "POST", h });
    },
    put(_p: string, h: any) {
      appState.routes.push({ m: "PUT", h });
    },
    delete(_p: string, h: any) {
      appState.routes.push({ m: "DELETE", h });
    },
    listen(_port: number, cb: () => void) {
      cb();
    },
  } as any;
  const express = () => app;
  (express as any).json = () => (_req: any, _res: any, next: any) => next?.();
  return { default: express };
});
vi.mock("helmet", () => ({ default: () => (_req: any, _res: any, _next: any) => _next?.() }));
vi.mock("cors", () => ({ default: () => (_req: any, _res: any, _next: any) => _next?.() }));
vi.mock("pino-http", () => ({ default: () => (_req: any, _res: any, _next: any) => _next?.() }));

describe("express adapter extended", () => {
  it("supports header array, both redirect branches, and error fallbacks", async () => {
    const { createExpressServer } = await import("../http/express-server.js");
    const server = createExpressServer();
    let headers: Record<string, any> = {};
    let redirectArgs: any[] = [];

    // Register a route that throws to test error handler
    server.get("/t", async (_req: any, res: any) => {
      res.header("Set-Cookie", ["a=1", "b=2"]);
      res.redirect("/x", 302);
      res.redirect("/y");
      const err: any = new Error("teapot");
      err.status = 418;
      throw err;
    });
    const h = appState.routes.find((r: any) => r.m === "GET")!.h;
    const res = {
      status(code: number) {
        headers.status = code;
        return this;
      },
      json(obj: any) {
        headers.json = obj;
      },
      setHeader(name: string, value: any) {
        headers[name] = value;
      },
      redirect(statusOrUrl: any, maybeUrl?: any) {
        if (typeof statusOrUrl === "number") redirectArgs = [maybeUrl, statusOrUrl];
        else redirectArgs = [statusOrUrl];
      },
    } as any;
    await h({ headers: {}, params: {}, query: {} } as any, res, (err: any) => {
      // invoke captured error handler
      appState.errorHandler(err, {} as any, res, () => {});
    });
    expect(headers["Set-Cookie"]).toEqual(["a=1", "b=2"]);
    expect(redirectArgs).toEqual(["/y"]);
    expect(headers.status).toBe(418);
    expect(headers.json).toMatchObject({ status: "error", message: "teapot" });

    // Now trigger error handler with an object without status/message to hit fallbacks
    headers = {};
    appState.errorHandler({} as any, {} as any, res as any, () => {});
    expect(headers.status).toBe(500);
    expect(headers.json).toMatchObject({ code: "INTERNAL", message: "Internal Server Error" });
  });
});
