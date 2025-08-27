import { describe, it, expect, vi, afterEach } from "vitest";
import fs from "fs";
import { registerOpenApiRoute } from "../routes/openapi.js";
import type { HttpHandler } from "../http/http-server.js";

describe("openapi route", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function setupRoute() {
    const handlers = new Map<string, HttpHandler>();
    const server = {
      get: (p: string, h: HttpHandler) => handlers.set(`GET ${p}`, h),
    } as any;
    registerOpenApiRoute(server);
    const handler = handlers.get("GET /openapi.json");
    if (!handler) throw new Error("openapi handler not registered");
    return handler;
  }

  it("returns bundled OpenAPI JSON when present", async () => {
    const handler = setupRoute();

    vi.spyOn(fs, "existsSync").mockReturnValue(true);
    const openapiDoc = { openapi: "3.1.0", info: { title: "Latchflow API", version: "0.1.0" } };
    vi.spyOn(
      fs.promises as unknown as { readFile: typeof fs.promises.readFile },
      "readFile",
    ).mockResolvedValue(JSON.stringify(openapiDoc));

    let status = 0;
    let json: any;
    const headers: Record<string, string | string[]> = {};
    await handler({} as any, {
      status(c: number) {
        status = c;
        return this as any;
      },
      json(p: unknown) {
        json = p;
      },
      header(name: string, value: string | string[]) {
        headers[name] = value;
        return this as any;
      },
      redirect() {},
    });

    expect(status).toBe(200);
    expect(headers["Content-Type"]).toBe("application/json");
    expect(json).toEqual(openapiDoc);
  });

  it("returns 404 with code OAS_NOT_BUNDLED when bundle is missing", async () => {
    const handler = setupRoute();

    vi.spyOn(fs, "existsSync").mockReturnValue(false);

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

    expect(status).toBe(404);
    expect(json).toEqual({
      status: "error",
      code: "OAS_NOT_BUNDLED",
      message: "OpenAPI bundle not found. Run pnpm oas:bundle.",
    });
  });

  it("returns 500 with code OAS_READ_ERROR when read fails", async () => {
    const handler = setupRoute();

    vi.spyOn(fs, "existsSync").mockReturnValue(true);
    vi.spyOn(
      fs.promises as unknown as { readFile: typeof fs.promises.readFile },
      "readFile",
    ).mockRejectedValue(new Error("boom"));

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

    expect(status).toBe(500);
    expect(json).toEqual({ status: "error", code: "OAS_READ_ERROR", message: "boom" });
  });
});
