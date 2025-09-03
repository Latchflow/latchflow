import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";
import type { HttpHandler } from "../../http/http-server.js";
import { createMemoryStorage } from "../../storage/memory.js";
import { createStorageService } from "../../storage/service.js";

// Mock DB client
const db = {
  file: {
    findMany: vi.fn(async (): Promise<any[]> => []),
    findUnique: vi.fn(async (): Promise<any> => null),
    update: vi.fn(async (): Promise<any> => ({})),
    delete: vi.fn(async (): Promise<any> => ({})),
    deleteMany: vi.fn(async (): Promise<any> => ({})),
  },
  apiToken: {
    findUnique: vi.fn(async (): Promise<any> => null),
    update: vi.fn(async (): Promise<any> => ({})),
  },
  user: { findUnique: vi.fn(async (): Promise<any> => null) },
};
vi.mock("../../db/db.js", () => ({ getDb: () => db }));

// Provide a storage service instance via instance getter
let storageSvc: ReturnType<typeof createStorageService>;

// Default: requireSession passes (for cookie path) but we'll exercise bearer more
vi.mock("../../middleware/require-session.js", () => ({
  requireSession: vi.fn(async () => ({ user: { id: "u1", role: "ADMIN" } })),
}));

async function makeServer() {
  const handlers = new Map<string, HttpHandler>();
  const server = {
    get: (p: string, h: HttpHandler) => handlers.set(`GET ${p}`, h),
    post: (p: string, h: HttpHandler) => handlers.set(`POST ${p}`, h),
    delete: (p: string, h: HttpHandler) => handlers.set(`DELETE ${p}`, h),
  } as any;
  const { registerFileAdminRoutes } = await import("./files.js");
  registerFileAdminRoutes(server, { storage: storageSvc } as any);
  return { handlers };
}

function resCapture() {
  let status = 0;
  let body: any = null;
  const headers: Record<string, string | string[]> = {};
  let streamCalled: { headers: Record<string, string | string[]> } | null = null;
  const res = {
    status(c: number) {
      status = c;
      return this as any;
    },
    json(p: any) {
      body = p;
    },
    header(name: string, value: any) {
      headers[name] = value;
      return this as any;
    },
    redirect() {},
    sendStream(_s: any, h?: any) {
      streamCalled = { headers: h ?? {} };
    },
    sendBuffer() {},
  } as any;
  return {
    res,
    get status() {
      return status;
    },
    get body() {
      return body;
    },
    get headers() {
      return headers;
    },
    get stream() {
      return streamCalled;
    },
  };
}

describe("files admin routes", () => {
  beforeAll(async () => {
    const driver = await createMemoryStorage({ config: null } as any);
    storageSvc = createStorageService({ driver, bucket: "b", keyPrefix: "p" } as any);
  });
  beforeEach(() => {
    // Clear call history but keep default async implementations
    Object.values(db.file).forEach((fn: any) => fn?.mockClear?.());
  });

  it("GET /files lists files", async () => {
    const now = new Date().toISOString();
    db.file.findMany.mockResolvedValueOnce([
      {
        id: "f1",
        key: "docs/readme.txt",
        size: BigInt(10),
        contentType: "text/plain",
        metadata: { lang: "en" },
        contentHash: "a".repeat(64),
        updatedAt: now,
      },
    ] as any);
    const { handlers } = await makeServer();
    const h = handlers.get("GET /files")!;
    const rc = resCapture();
    await h({ headers: {} } as any, rc.res);
    expect(rc.status).toBe(200);
    expect(rc.body?.items?.[0]?.key).toBe("docs/readme.txt");
    expect(rc.body?.items?.[0]?.etag?.length).toBe(64);
  });

  it("GET /files/:id returns metadata", async () => {
    const now = new Date().toISOString();
    db.file.findUnique.mockResolvedValueOnce({
      id: "f1",
      key: "a.txt",
      size: BigInt(1),
      contentType: "text/plain",
      updatedAt: now,
      metadata: null,
      contentHash: null,
    } as any);
    const { handlers } = await makeServer();
    const h = handlers.get("GET /files/:id")!;
    const rc = resCapture();
    await h({ params: { id: "f1" }, headers: {} } as any, rc.res);
    expect(rc.status).toBe(200);
    expect(rc.body?.id).toBe("f1");
  });

  it("GET /files/:id/download streams with headers", async () => {
    // Seed storage with a known object key
    const { storageKey } = await storageSvc.putFile({
      body: Buffer.from("abc"),
      contentType: "text/plain",
    });
    db.file.findUnique.mockResolvedValueOnce({
      id: "f1",
      key: "a.txt",
      size: BigInt(3),
      contentType: "text/plain",
      storageKey,
      contentHash: "h".repeat(64),
    } as any);
    const { handlers } = await makeServer();
    const h = handlers.get("GET /files/:id/download")!;
    const rc = resCapture();
    await h({ params: { id: "f1" }, headers: {} } as any, rc.res);
    expect(rc.stream).toBeTruthy();
    expect(rc.stream?.headers?.["Content-Type"]).toBe("text/plain");
    expect(rc.stream?.headers?.["ETag"]).toBe("h".repeat(64));
    expect(rc.stream?.headers?.["Content-Length"]).toBe("3");
  });

  it("DELETE /files/:id deletes and returns 204", async () => {
    db.file.findUnique.mockResolvedValueOnce({
      id: "f1",
      storageKey: "p/objects/sha256/aa/bb/key",
    } as any);
    const { handlers } = await makeServer();
    const h = handlers.get("DELETE /files/:id")!;
    const rc = resCapture();
    await h({ params: { id: "f1" }, headers: {} } as any, rc.res);
    expect(rc.status).toBe(204);
    expect(db.file.deleteMany).toHaveBeenCalled();
  });

  it("POST /files/:id/move updates key and returns 204", async () => {
    const { handlers } = await makeServer();
    const h = handlers.get("POST /files/:id/move")!;
    const rc = resCapture();
    await h({ params: { id: "f1" }, body: { newKey: "b.txt" }, headers: {} } as any, rc.res);
    expect(rc.status).toBe(204);
    expect(db.file.update).toHaveBeenCalledWith({ where: { id: "f1" }, data: { key: "b.txt" } });
  });

  it("PATCH /files/:id/metadata updates metadata and returns 204", async () => {
    const { handlers } = await makeServer();
    const h = handlers.get("POST /files/:id/metadata")!; // using POST route for metadata per implementation
    const rc = resCapture();
    await h(
      {
        params: { id: "f1" },
        body: { metadata: { a: "1" } },
        headers: {},
      } as any,
      rc.res,
    );
    expect(rc.status).toBe(204);
    expect(db.file.update).toHaveBeenCalledWith({
      where: { id: "f1" },
      data: { metadata: { a: "1" } },
    });
  });
});
