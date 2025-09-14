import { describe, it, expect, vi, beforeAll } from "vitest";
import type { HttpHandler } from "../src/http/http-server.js";
import { createMemoryStorage } from "../src/storage/memory.js";
import { createStorageService } from "../src/storage/service.js";

// Minimal DB mock wired via getDb() mock
const db = {
  file: {
    findMany: vi.fn(async (): Promise<any[]> => []),
    findUnique: vi.fn(async (): Promise<any> => null),
    create: vi.fn(async (): Promise<any> => ({})),
    update: vi.fn(async (): Promise<any> => ({})),
    deleteMany: vi.fn(async (): Promise<any> => ({})),
  },
  apiToken: { findUnique: vi.fn(async (): Promise<any> => null), update: vi.fn(async () => ({})) },
  user: { findUnique: vi.fn(async (): Promise<any> => null) },
};
vi.mock("../src/db/db.js", () => ({ getDb: () => db }));

// Admin session shortcut
vi.mock("../src/middleware/require-session.js", () => ({
  requireSession: vi.fn(async () => ({ user: { id: "u1", role: "ADMIN", isActive: true } })),
}));

let storageSvc: ReturnType<typeof createStorageService>;

async function makeServer() {
  const handlers = new Map<string, HttpHandler>();
  const server = {
    get: (p: string, h: HttpHandler) => handlers.set(`GET ${p}`, h),
    post: (p: string, h: HttpHandler) => handlers.set(`POST ${p}`, h),
    delete: (p: string, h: HttpHandler) => handlers.set(`DELETE ${p}`, h),
  } as any;
  const { registerFileAdminRoutes } = await import("../src/routes/admin/files.js");
  registerFileAdminRoutes(server, { storage: storageSvc } as any);
  return { handlers };
}

async function makeServerWithHook(onFilesChanged: (ids: string[]) => Promise<void> | void) {
  const handlers = new Map<string, HttpHandler>();
  const server = {
    get: (p: string, h: HttpHandler) => handlers.set(`GET ${p}`, h),
    post: (p: string, h: HttpHandler) => handlers.set(`POST ${p}`, h),
    delete: (p: string, h: HttpHandler) => handlers.set(`DELETE ${p}`, h),
  } as any;
  const { registerFileAdminRoutes } = await import("../src/routes/admin/files.js");
  registerFileAdminRoutes(server, { storage: storageSvc, onFilesChanged } as any);
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

describe("files integration (in-package)", () => {
  beforeAll(async () => {
    const driver = await createMemoryStorage({ config: null } as any);
    storageSvc = createStorageService({ driver, bucket: "b", keyPrefix: "p" } as any);
  });

  it("upload → list → download → delete", async () => {
    const state: any[] = [];
    // In-memory behavior for this test only
    (db.file.create as any).mockImplementationOnce(async ({ data, select }: any) => {
      const row = {
        id: "f-int-1",
        key: data.key,
        size: data.size,
        contentType: data.contentType,
        metadata: data.metadata ?? null,
        contentHash: data.contentHash,
        storageKey: data.storageKey,
        updatedAt: new Date().toISOString(),
      };
      state.push(row);
      return Object.fromEntries(Object.keys(select).map((k) => [k, (row as any)[k]]));
    });
    (db.file.findMany as any).mockImplementation(async ({ select }: any) => {
      return state.map((r) =>
        Object.fromEntries(Object.keys(select).map((k) => [k, (r as any)[k]])),
      );
    });
    (db.file.findUnique as any).mockImplementation(async ({ where, select }: any) => {
      const r = state.find((x) => x.id === where.id);
      if (!r) return null;
      return Object.fromEntries(Object.keys(select).map((k) => [k, (r as any)[k]]));
    });
    (db.file.deleteMany as any).mockImplementationOnce(async ({ where }: any) => {
      const id = where.id;
      const idx = state.findIndex((x) => x.id === id);
      if (idx >= 0) state.splice(idx, 1);
      return {};
    });

    const { handlers } = await makeServer();

    // 1) upload
    const hUpload = handlers.get("POST /files/upload")!;
    const rcUp = resCapture();
    await hUpload(
      {
        headers: { "content-type": "multipart/form-data" },
        body: { key: "int/file.txt", metadata: { i: "1" } },
        file: {
          buffer: Buffer.from("integration-bytes"),
          originalname: "file.txt",
          mimetype: "text/plain",
          size: 18,
        },
      } as any,
      rcUp.res,
    );
    expect(rcUp.status).toBe(201);
    const etag = rcUp.headers["ETag"] as string;
    expect(typeof etag).toBe("string");

    // 2) list
    const hList = handlers.get("GET /files")!;
    const rcList = resCapture();
    await hList({ headers: {} } as any, rcList.res);
    expect(rcList.status).toBe(200);
    expect(rcList.body?.items?.length).toBeGreaterThan(0);

    // 3) download
    const hGet = handlers.get("GET /files/:id")!;
    const rcMeta = resCapture();
    await hGet({ headers: {}, params: { id: "f-int-1" } } as any, rcMeta.res);
    expect(rcMeta.status).toBe(200);
    const hDl = handlers.get("GET /files/:id/download")!;
    const rcDl = resCapture();
    await hDl({ headers: {}, params: { id: "f-int-1" } } as any, rcDl.res);
    expect(rcDl.stream).toBeTruthy();
    expect(rcDl.stream?.headers?.["ETag"]).toBe(etag);
    const chunks: Buffer[] = [];
    await new Promise<void>((resolve, reject) => {
      const s: any = rcDl.stream?.stream;
      s.on("data", (c: Buffer) => chunks.push(Buffer.from(c)));
      s.on("end", resolve);
      s.on("error", reject);
    });
    expect(Buffer.concat(chunks).toString("utf8")).toBe("integration-bytes");

    // 4) delete
    const hDel = handlers.get("DELETE /files/:id")!;
    const rcDel = resCapture();
    await hDel({ headers: {}, params: { id: "f-int-1" } } as any, rcDel.res);
    expect(rcDel.status).toBe(204);

    // 5) confirm list no longer includes the item
    const rcList2 = resCapture();
    await hList({ headers: {} } as any, rcList2.res);
    expect(rcList2.status).toBe(200);
    const hasItem =
      Array.isArray(rcList2.body?.items) &&
      rcList2.body.items.some((it: any) => it.id === "f-int-1");
    expect(hasItem).toBe(false);
  });

  it("upload triggers onFilesChanged hook with created file id", async () => {
    const calls: string[][] = [];
    (db.file.create as any).mockImplementationOnce(async ({ data, select }: any) => {
      const row = {
        id: "f-hook-1",
        key: data.key,
        size: data.size,
        contentType: data.contentType,
        metadata: data.metadata ?? null,
        contentHash: data.contentHash,
        storageKey: data.storageKey,
        updatedAt: new Date().toISOString(),
      };
      return Object.fromEntries(Object.keys(select).map((k) => [k, (row as any)[k]]));
    });
    const { handlers } = await makeServerWithHook(async (ids) => {
      calls.push(ids);
    });
    const hUpload = handlers.get("POST /files/upload")!;
    const rcUp = resCapture();
    await hUpload(
      {
        headers: { "content-type": "multipart/form-data" },
        body: { key: "hook/file.txt" },
        file: {
          buffer: Buffer.from("x"),
          originalname: "file.txt",
          mimetype: "text/plain",
          size: 1,
        },
      } as any,
      rcUp.res,
    );
    expect(rcUp.status).toBe(201);
    expect(Array.isArray(calls[0])).toBe(true);
    expect(calls[0][0]).toBe("f-hook-1");
  });
});
