import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";
import type { HttpHandler } from "../../http/http-server.js";
import { createMemoryStorage } from "../../storage/memory.js";
import { createStorageService } from "../../storage/service.js";

// Mock DB client
const db = {
  file: {
    findMany: vi.fn(async (): Promise<any[]> => []),
    findUnique: vi.fn(async (): Promise<any> => null),
    create: vi.fn(async (): Promise<any> => ({})),
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
  let streamCalled: { headers: Record<string, string | string[]>; stream?: any } | null = null;
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
    sendStream(s: any, h?: any) {
      streamCalled = { headers: h ?? {}, stream: s };
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
    expect(rc.body?.items?.[0]?.contentHash?.length).toBe(64);
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

  it("POST /files/upload creates a File and returns 201 with ETag", async () => {
    const { handlers } = await makeServer();
    const h = handlers.get("POST /files/upload")!;
    const rc = resCapture();
    // Mock DB create to echo back fields
    (db.file.create as any).mockResolvedValueOnce({
      id: "f-new",
      key: "uploads/hello.txt",
      size: BigInt(11),
      contentType: "text/plain",
      metadata: { tag: "x" },
      contentHash: "x".repeat(64),
      updatedAt: new Date().toISOString(),
    });
    await h(
      {
        headers: { "content-type": "multipart/form-data" },
        body: { key: "uploads/hello.txt", metadata: { tag: "x" } },
        file: {
          buffer: Buffer.from("hello world"),
          originalname: "hello.txt",
          mimetype: "text/plain",
          size: 11,
        },
      } as any,
      rc.res,
    );
    expect(rc.status).toBe(201);
    expect(rc.headers["ETag"]).toBeDefined();
    expect(rc.headers["Location"]).toBe("/files/f-new");
    expect(rc.body?.key).toBe("uploads/hello.txt");
  });

  it("POST /files/upload returns 409 when key already exists", async () => {
    const { handlers } = await makeServer();
    const h = handlers.get("POST /files/upload")!;
    const rc = resCapture();
    // Simulate unique constraint violation
    (db.file.create as any).mockRejectedValueOnce({ code: "P2002" });
    await h(
      {
        headers: { "content-type": "multipart/form-data" },
        body: { key: "uploads/dupe.txt" },
        file: {
          buffer: Buffer.from("abc"),
          originalname: "dupe.txt",
          mimetype: "text/plain",
          size: 3,
        },
      } as any,
      rc.res,
    );
    expect(rc.status).toBe(409);
    expect(rc.body?.code).toBe("CONFLICT");
  });

  it("POST /files/upload with overwrite updates existing and returns 200", async () => {
    const { handlers } = await makeServer();
    const h = handlers.get("POST /files/upload")!;
    const rc = resCapture();
    // Simulate existing file
    (db.file.findUnique as any).mockResolvedValueOnce({ id: "f1" });
    // update returns the selected shape
    (db.file.update as any).mockResolvedValueOnce({
      id: "f1",
      key: "uploads/hello.txt",
      size: BigInt(11),
      contentType: "text/plain",
      metadata: { tag: "y" },
      contentHash: "y".repeat(64),
      updatedAt: new Date().toISOString(),
    });
    await h(
      {
        headers: { "content-type": "multipart/form-data" },
        body: { key: "uploads/hello.txt", overwrite: true },
        file: {
          buffer: Buffer.from("hello world"),
          originalname: "hello.txt",
          mimetype: "text/plain",
          size: 11,
        },
      } as any,
      rc.res,
    );
    expect(rc.status).toBe(200);
    expect(db.file.update).toHaveBeenCalled();
    expect(rc.headers["ETag"]).toBeDefined();
    expect(rc.headers["Location"]).toBe("/files/f1");
  });

  it("POST /files/batch/delete deletes storage and DB then returns 204", async () => {
    const { handlers } = await makeServer();
    const h = handlers.get("POST /files/batch/delete")!;
    const rc = resCapture();
    // Spy on storage deleteFile to verify calls
    const spy = vi.spyOn(storageSvc, "deleteFile");
    (db.file.findMany as any).mockResolvedValueOnce([
      { id: "a", storageKey: "p/objects/sha256/aa/bb/x" },
      { id: "b", storageKey: "p/objects/sha256/cc/dd/y" },
    ]);
    await h({ headers: {}, body: { ids: ["a", "b"] } } as any, rc.res);
    expect(rc.status).toBe(204);
    expect(db.file.deleteMany).toHaveBeenCalledWith({ where: { id: { in: ["a", "b"] } } });
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("POST /files/batch/move updates keys and returns 204", async () => {
    const { handlers } = await makeServer();
    const h = handlers.get("POST /files/batch/move")!;
    const rc = resCapture();
    await h(
      {
        headers: {},
        body: {
          items: [
            { id: "a", newKey: "k1" },
            { id: "b", newKey: "k2" },
          ],
        },
      } as any,
      rc.res,
    );
    expect(rc.status).toBe(204);
    expect(db.file.update).toHaveBeenCalledWith({ where: { id: "a" }, data: { key: "k1" } });
    expect(db.file.update).toHaveBeenCalledWith({ where: { id: "b" }, data: { key: "k2" } });
  });

  it("POST /files/batch/move returns 409 on key conflict", async () => {
    const { handlers } = await makeServer();
    const h = handlers.get("POST /files/batch/move")!;
    const rc = resCapture();
    // First update succeeds, second fails with unique constraint
    (db.file.update as any).mockResolvedValueOnce({}).mockRejectedValueOnce({ code: "P2002" });
    await h(
      {
        headers: {},
        body: {
          items: [
            { id: "a", newKey: "k1" },
            { id: "b", newKey: "dupe" },
          ],
        },
      } as any,
      rc.res,
    );
    expect(rc.status).toBe(409);
    expect(rc.body?.code).toBe("CONFLICT");
  });
});
