import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";
import type { HttpHandler } from "../../http/http-server.js";
import { createMemoryStorage } from "../../storage/memory.js";
import { createStorageService } from "../../storage/service.js";
import { createResponseCapture } from "@tests/helpers/response";

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
  fileUploadReservation: {
    create: vi.fn(async (..._args: any[]) => ({})),
    findUnique: vi.fn(async (..._args: any[]) => null),
    update: vi.fn(async (..._args: any[]) => ({})),
  },
  apiToken: {
    findUnique: vi.fn(async (): Promise<any> => null),
    update: vi.fn(async (): Promise<any> => ({})),
  },
  user: { findUnique: vi.fn(async (): Promise<any> => null) },
};
vi.mock("../../db/db.js", () => ({ getDb: () => db }));

// Mock authorization modules
vi.mock("../../authz/authorize.js", () => ({
  authorizeRequest: vi.fn(() => ({
    decision: { ok: true, reason: "RULE_MATCH" },
    rulesHash: "hash",
  })),
}));

vi.mock("../../authz/featureFlags.js", () => ({
  getAuthzMode: vi.fn(() => "off"),
  getSystemUserId: vi.fn(() => "system"),
  isAdmin2faRequired: vi.fn(() => false),
  getReauthWindowMs: vi.fn(() => 15 * 60 * 1000),
}));

vi.mock("../../authz/decisionLog.js", () => ({
  logDecision: vi.fn(),
}));

vi.mock("../../observability/metrics.js", () => ({
  recordAuthzDecision: vi.fn(),
  recordAuthzTwoFactor: vi.fn(),
}));

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
    patch: (p: string, h: HttpHandler) => handlers.set(`PATCH ${p}`, h),
    delete: (p: string, h: HttpHandler) => handlers.set(`DELETE ${p}`, h),
  } as any;
  const { registerFileAdminRoutes } = await import("./files.js");
  registerFileAdminRoutes(server, { storage: storageSvc } as any);
  return { handlers };
}

describe("files admin routes", () => {
  beforeAll(async () => {
    const driver = await createMemoryStorage({ config: null } as any);
    storageSvc = createStorageService({ driver, bucket: "b", keyPrefix: "p" } as any);
  });
  beforeEach(() => {
    // Clear call history but keep default async implementations
    Object.values(db.file).forEach((fn: any) => fn?.mockClear?.());
    Object.values(db.fileUploadReservation).forEach((fn: any) => fn?.mockClear?.());
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
    const rc = createResponseCapture();
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
    const rc = createResponseCapture();
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
    const rc = createResponseCapture();
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
    const rc = createResponseCapture();
    await h({ params: { id: "f1" }, headers: {} } as any, rc.res);
    expect(rc.status).toBe(204);
    expect(db.file.deleteMany).toHaveBeenCalled();
  });

  it("POST /files/:id/move updates key and returns 204", async () => {
    const { handlers } = await makeServer();
    const h = handlers.get("POST /files/:id/move")!;
    const rc = createResponseCapture();
    await h({ params: { id: "f1" }, body: { newKey: "b.txt" }, headers: {} } as any, rc.res);
    expect(rc.status).toBe(204);
    expect(db.file.update).toHaveBeenCalledWith({ where: { id: "f1" }, data: { key: "b.txt" } });
  });

  it("PATCH /files/:id/metadata updates metadata and returns 204", async () => {
    const { handlers } = await makeServer();
    const h = handlers.get("PATCH /files/:id/metadata")!;
    const rc = createResponseCapture();
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
    const rc = createResponseCapture();
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
    const rc = createResponseCapture();
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
    const rc = createResponseCapture();
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
    const rc = createResponseCapture();
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
    const rc = createResponseCapture();
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
    const rc = createResponseCapture();
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

  it("POST /files/upload-url returns 501 when driver lacks presign support", async () => {
    // Use memory storage (no presign)
    const driver = await createMemoryStorage({ config: null } as any);
    storageSvc = createStorageService({ driver, bucket: "b", keyPrefix: "p" } as any);
    const { handlers } = await makeServer();
    const h = handlers.get("POST /files/upload-url")!;
    const rc = createResponseCapture();
    await h(
      {
        headers: {},
        body: { key: "k1", sha256: "a".repeat(64), contentType: "text/plain" },
      } as any,
      rc.res,
    );
    expect(rc.status).toBe(501);
    expect(rc.body?.code).toBe("NOT_IMPLEMENTED");
  });

  it("POST /files/upload-url creates reservation and returns presigned URL when supported", async () => {
    // Fake driver with presign support
    const driver = {
      put: vi.fn(),
      getStream: vi.fn(),
      head: vi.fn(),
      del: vi.fn(),
      createSignedPutUrl: vi.fn(async ({ key, contentType }) => ({
        url: `https://signed/${key}`,
        headers: { "content-type": contentType!, "x-amz-checksum-sha256": "abc" },
      })),
    } as any;
    storageSvc = createStorageService({ driver, bucket: "b", keyPrefix: "p" } as any);
    const { handlers } = await makeServer();
    const h = handlers.get("POST /files/upload-url")!;
    const rc = createResponseCapture();
    await h(
      {
        headers: {},
        body: { key: "k1", sha256: "b".repeat(64), contentType: "text/plain" },
      } as any,
      rc.res,
    );
    expect(rc.status).toBe(201);
    expect(db.fileUploadReservation.create).toHaveBeenCalled();
    expect(rc.body?.url).toContain("https://signed/");
    expect(rc.body?.tempKey).toMatch(/^p\/tmp\/uploads\//);
    expect(rc.body?.reservationId).toBeTruthy();
  });

  it("POST /files/commit finalizes upload, verifies checksum, and creates File", async () => {
    const sha = "c".repeat(64);
    const tempKey = "p/tmp/uploads/uuid-1";
    const reservationId = "11111111-1111-1111-1111-111111111111";
    // Fake driver that supports head/copy/del
    const driver = {
      put: vi.fn(),
      getStream: vi.fn(),
      head: vi.fn(async () => ({
        size: 10,
        contentType: "text/plain",
        checksumSha256Hex: sha,
        metadata: {},
      })),
      del: vi.fn(async () => {}),
      copyObject: vi.fn(async () => ({ etag: "etag-123" })),
    } as any;
    storageSvc = createStorageService({ driver, bucket: "b", keyPrefix: "p" } as any);
    // Mock reservation lookup
    (db.fileUploadReservation.findUnique as any).mockResolvedValueOnce({
      id: reservationId,
      tempKey,
      desiredKey: "k-final",
      sha256: sha,
      requestedContentType: "text/plain",
      requestedSize: BigInt(10),
      metadata: { tag: "x" },
      createdBy: "u1",
      expiresAt: new Date(Date.now() + 60_000),
      consumedAt: null,
    });
    // Mock file create select shape
    (db.file.create as any).mockResolvedValueOnce({
      id: "f-new",
      key: "k-final",
      size: BigInt(10),
      contentType: "text/plain",
      metadata: { tag: "x" },
      contentHash: sha,
      etag: "etag-123",
      updatedAt: new Date().toISOString(),
    });
    const { handlers } = await makeServer();
    const h = handlers.get("POST /files/commit")!;
    const rc = createResponseCapture();
    await h({ headers: {}, body: { key: "k-final", reservationId } } as any, rc.res);
    expect(rc.status).toBe(201);
    expect(db.file.create).toHaveBeenCalled();
    expect(db.fileUploadReservation.update).toHaveBeenCalledWith({
      where: { id: reservationId },
      data: { consumedAt: expect.any(Date) },
    });
    expect(rc.headers["ETag"]).toBe("etag-123");
    expect(rc.body?.key).toBe("k-final");
  });

  it("POST /files/commit returns 409 when key exists and overwrite is false", async () => {
    const sha = "d".repeat(64);
    const tempKey = "p/tmp/uploads/uuid-2";
    const reservationId = "22222222-2222-2222-2222-222222222222";
    const driver = {
      put: vi.fn(),
      getStream: vi.fn(),
      head: vi.fn(async () => ({ size: 5, checksumSha256Hex: sha })),
      del: vi.fn(async () => {}),
      copyObject: vi.fn(async () => ({ etag: "etag-999" })),
    } as any;
    storageSvc = createStorageService({ driver, bucket: "b", keyPrefix: "p" } as any);
    (db.fileUploadReservation.findUnique as any).mockResolvedValueOnce({
      id: reservationId,
      tempKey,
      desiredKey: "k-exists",
      sha256: sha,
      requestedContentType: "application/octet-stream",
      createdBy: "u1",
      expiresAt: new Date(Date.now() + 60_000),
      consumedAt: null,
    });
    // Simulate unique constraint violation on create
    (db.file.create as any).mockRejectedValueOnce({ code: "P2002" });
    const { handlers } = await makeServer();
    const h = handlers.get("POST /files/commit")!;
    const rc = createResponseCapture();
    await h({ headers: {}, body: { key: "k-exists", reservationId } } as any, rc.res);
    expect(rc.status).toBe(409);
    expect(rc.body?.code).toBe("CONFLICT");
  });

  it("POST /files/commit rejects on checksum mismatch", async () => {
    const tempKey = "p/tmp/uploads/uuid-3";
    const reservationId = "33333333-3333-3333-3333-333333333333";
    const driver = {
      put: vi.fn(),
      getStream: vi.fn(),
      head: vi.fn(async () => ({ size: 5, checksumSha256Hex: "e".repeat(64) })),
      del: vi.fn(async () => {}),
      copyObject: vi.fn(async () => ({ etag: "etag-1" })),
    } as any;
    storageSvc = createStorageService({ driver, bucket: "b", keyPrefix: "p" } as any);
    (db.fileUploadReservation.findUnique as any).mockResolvedValueOnce({
      id: reservationId,
      tempKey,
      desiredKey: "k-final",
      sha256: "f".repeat(64),
      requestedContentType: "text/plain",
      createdBy: "u1",
      expiresAt: new Date(Date.now() + 60_000),
      consumedAt: null,
    });
    const { handlers } = await makeServer();
    const h = handlers.get("POST /files/commit")!;
    const rc = createResponseCapture();
    await h({ headers: {}, body: { key: "k-final", reservationId } } as any, rc.res);
    expect(rc.status).toBe(400);
    expect(rc.body?.code).toBe("CHECKSUM_MISMATCH");
  });

  it("POST /files/commit rejects expired or consumed reservations", async () => {
    const tempKey = "p/tmp/uploads/uuid-4";
    const expiredId = "44444444-4444-4444-4444-444444444444";
    const usedId = "55555555-5555-5555-5555-555555555555";
    const driver = {
      put: vi.fn(),
      getStream: vi.fn(),
      head: vi.fn(async () => ({ size: 5, checksumSha256Hex: "a".repeat(64) })),
      del: vi.fn(async () => {}),
      copyObject: vi.fn(async () => ({ etag: "etag-1" })),
    } as any;
    storageSvc = createStorageService({ driver, bucket: "b", keyPrefix: "p" } as any);
    // Expired
    (db.fileUploadReservation.findUnique as any).mockResolvedValueOnce({
      id: expiredId,
      tempKey,
      desiredKey: "k1",
      sha256: "a".repeat(64),
      createdBy: "u1",
      expiresAt: new Date(Date.now() - 1000),
      consumedAt: null,
    });
    let { handlers } = await makeServer();
    let h = handlers.get("POST /files/commit")!;
    let rc = createResponseCapture();
    await h({ headers: {}, body: { key: "k1", reservationId: expiredId } } as any, rc.res);
    expect(rc.status).toBe(400);
    expect(rc.body?.code).toBe("EXPIRED");

    // Consumed
    (db.fileUploadReservation.findUnique as any).mockResolvedValueOnce({
      id: usedId,
      tempKey,
      desiredKey: "k1",
      sha256: "a".repeat(64),
      createdBy: "u1",
      expiresAt: new Date(Date.now() + 60_000),
      consumedAt: new Date(),
    });
    ({ handlers } = await makeServer());
    h = handlers.get("POST /files/commit")!;
    rc = createResponseCapture();
    await h({ headers: {}, body: { key: "k1", reservationId: usedId } } as any, rc.res);
    expect(rc.status).toBe(400);
    expect(rc.body?.code).toBe("INVALID_RESERVATION");
  });

  it("POST /files/commit rejects when key mismatches reservation", async () => {
    const tempKey = "p/tmp/uploads/uuid-5";
    const sha = "a".repeat(64);
    const reservationId = "66666666-6666-6666-6666-666666666666";
    const driver = {
      put: vi.fn(),
      getStream: vi.fn(),
      head: vi.fn(async () => ({ size: 5, checksumSha256Hex: sha })),
      del: vi.fn(async () => {}),
      copyObject: vi.fn(async () => ({ etag: "etag-1" })),
    } as any;
    storageSvc = createStorageService({ driver, bucket: "b", keyPrefix: "p" } as any);
    (db.fileUploadReservation.findUnique as any).mockResolvedValueOnce({
      id: reservationId,
      tempKey,
      desiredKey: "k-correct",
      sha256: sha,
      createdBy: "u1",
      expiresAt: new Date(Date.now() + 60_000),
      consumedAt: null,
    });
    const { handlers } = await makeServer();
    const h = handlers.get("POST /files/commit")!;
    const rc = createResponseCapture();
    await h({ headers: {}, body: { key: "k-wrong", reservationId } } as any, rc.res);
    expect(rc.status).toBe(400);
    expect(rc.body?.code).toBe("KEY_MISMATCH");
  });

  it("POST /files/commit with overwrite updates existing record and returns 200", async () => {
    const sha = "a".repeat(64);
    const tempKey = "p/tmp/uploads/uuid-6";
    const reservationId = "77777777-7777-7777-7777-777777777777";
    const driver = {
      put: vi.fn(),
      getStream: vi.fn(),
      head: vi.fn(async () => ({ size: 42, checksumSha256Hex: sha, contentType: "text/plain" })),
      del: vi.fn(async () => {}),
      copyObject: vi.fn(async () => ({ etag: "etag-overwrite" })),
    } as any;
    storageSvc = createStorageService({ driver, bucket: "b", keyPrefix: "p" } as any);
    (db.fileUploadReservation.findUnique as any).mockResolvedValueOnce({
      id: reservationId,
      tempKey,
      desiredKey: "k-overwrite",
      sha256: sha,
      requestedContentType: "text/plain",
      createdBy: "u1",
      expiresAt: new Date(Date.now() + 60_000),
      consumedAt: null,
    });
    (db.file.findUnique as any).mockResolvedValueOnce({ id: "f-existing" });
    (db.file.update as any).mockResolvedValueOnce({
      id: "f-existing",
      key: "k-overwrite",
      size: BigInt(42),
      contentType: "text/plain",
      metadata: null,
      contentHash: sha,
      etag: "etag-overwrite",
      updatedAt: new Date().toISOString(),
    });
    const { handlers } = await makeServer();
    const h = handlers.get("POST /files/commit")!;
    const rc = createResponseCapture();
    await h(
      { headers: {}, body: { key: "k-overwrite", reservationId, overwrite: true } } as any,
      rc.res,
    );
    expect(rc.status).toBe(200);
    expect(db.file.update).toHaveBeenCalledWith({
      where: { id: "f-existing" },
      data: expect.objectContaining({
        size: BigInt(42),
        contentType: "text/plain",
        contentHash: sha,
        storageKey: expect.stringMatching(/^p\/objects\/sha256\//),
        etag: "etag-overwrite",
      }),
      select: expect.any(Object),
    });
    expect(rc.headers["ETag"]).toBe("etag-overwrite");
    expect(rc.headers["Location"]).toBe("/files/f-existing");
  });
});
