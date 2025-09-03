import { describe, it, expect, vi } from "vitest";
import { Readable, Writable } from "node:stream";

// Mock express and middlewares to capture wrap behaviour consistently across tests
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

describe("express adapter", () => {
  it("creates a server with routing methods", async () => {
    const { createExpressServer } = await import("../http/express-server.js");
    const server = createExpressServer();
    expect(typeof server.get).toBe("function");
    expect(typeof server.post).toBe("function");
    expect(typeof server.listen).toBe("function");
  });

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

  it("sendStream pipes data and sets headers", async () => {
    // Reset captured routes to avoid interference from prior tests
    (appState as any).routes = [];
    const { createExpressServer } = await import("../http/express-server.js");
    const server = createExpressServer();
    // Register a streaming route
    server.get("/stream", async (_req: any, res: any) => {
      const stream = Readable.from(Buffer.from("hello world"));
      res.sendStream(stream, { "Content-Type": "text/plain", ETag: "hash123", "X-Test": "1" });
    });
    const getRoutes = appState.routes.filter((r: any) => r.m === "GET");
    const h = getRoutes[getRoutes.length - 1]!.h;

    const chunks: Buffer[] = [];
    const headers: Record<string, any> = {};
    const res = new Writable({
      write(chunk, _enc, cb) {
        (res as any).headersSent = true;
        chunks.push(Buffer.from(chunk));
        cb();
      },
    }) as unknown as Writable & {
      setHeader: (k: string, v: any) => void;
      status: (n: number) => any;
      json: (p: any) => void;
      redirect: (...args: any[]) => void;
      headersSent: boolean;
    };
    (res as any).headersSent = false;
    res.setHeader = (k: string, v: any) => {
      headers[k] = v;
    };
    res.status = (_n: number) => res;
    res.json = (_p: any) => void 0;
    res.redirect = () => void 0;

    await new Promise<void>((resolve, reject) => {
      h({ headers: {}, params: {}, query: {} } as any, res as any, reject);
      (res as any).on("finish", resolve);
    });
    const body = Buffer.concat(chunks).toString("utf8");
    expect(body).toBe("hello world");
    expect(headers["Content-Type"]).toBe("text/plain");
    expect(headers["ETag"]).toBe("hash123");
    expect(headers["X-Test"]).toBe("1");
  });

  it("sendStream returns 500 JSON on early stream error when headers not sent", async () => {
    // Reset captured routes to avoid interference from prior tests
    (appState as any).routes = [];
    const { createExpressServer } = await import("../http/express-server.js");
    const server = createExpressServer();
    server.get("/stream-error", async (_req: any, res: any) => {
      const erring = new Readable({
        read() {
          // emit error before any data
          this.destroy(new Error("boom"));
        },
      });
      res.sendStream(erring, { "Content-Type": "application/octet-stream" });
    });
    const getRoutes = appState.routes.filter((r: any) => r.m === "GET");
    const h = getRoutes[getRoutes.length - 1]!.h;

    const headers: Record<string, any> = {};
    const responses: any[] = [];
    const res = new Writable({
      write(_chunk, _enc, cb) {
        // mark headersSent if any bytes would be written; shouldn't happen in this test
        (res as any).headersSent = true;
        cb();
      },
    }) as unknown as Writable & {
      setHeader: (k: string, v: any) => void;
      status: (n: number) => any;
      json: (p: any) => void;
      redirect: (...args: any[]) => void;
      headersSent: boolean;
    };
    (res as any).headersSent = false;
    res.setHeader = (k: string, v: any) => {
      headers[k] = v;
    };
    res.status = (n: number) => {
      responses.push(["status", n]);
      return res as any;
    };
    res.json = (p: any) => {
      responses.push(["json", p]);
    };
    (res as any).redirect = () => void 0;

    await new Promise<void>((resolve, reject) => {
      h({ headers: {}, params: {}, query: {} } as any, res as any, reject);
      // give the error a tick
      setTimeout(resolve, 0);
    });
    // Should have responded with 500 JSON via sendStream's onError handler
    const statusEntry = responses.find((e) => e[0] === "status");
    const jsonEntry = responses.find((e) => e[0] === "json");
    expect(statusEntry?.[1]).toBe(500);
    expect(jsonEntry?.[1]).toMatchObject({ status: "error", code: "STREAM_ERROR" });
    // Headers are set but headersSent remains false (no writes)
    expect(res.headersSent).toBe(false);
    expect(headers["Content-Type"]).toBe("application/octet-stream");
  });
});
