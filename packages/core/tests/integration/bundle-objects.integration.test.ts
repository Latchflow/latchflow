import { describe, it, expect, vi, beforeEach } from "vitest";
import type { HttpHandler } from "../../src/http/http-server.js";

// Prisma-like mock
const db = {
  bundleObject: {
    findMany: vi.fn(async (): Promise<any[]> => []),
    findFirst: vi.fn(async (): Promise<any | null> => null),
    upsert: vi.fn(async (..._args: any[]): Promise<any> => ({})),
  },
  file: {
    findMany: vi.fn(async (): Promise<any[]> => []),
  },
};

vi.mock("../../src/db/db.js", () => ({ getDb: () => db }));

// Permission path relies on requireSession; allow ADMIN through
vi.mock("../../src/middleware/require-session.js", () => ({
  requireSession: vi.fn(async () => ({ user: { id: "u1", role: "ADMIN" } })),
}));

function makeServer() {
  const handlers = new Map<string, HttpHandler>();
  const server = {
    get: (p: string, h: HttpHandler) => handlers.set(`GET ${p}`, h),
    post: (p: string, h: HttpHandler) => handlers.set(`POST ${p}`, h),
    delete: (p: string, h: HttpHandler) => handlers.set(`DELETE ${p}`, h),
  } as any;
  const scheduler = { schedule: vi.fn(), scheduleForFiles: vi.fn(), getStatus: vi.fn() } as any;
  return { handlers, server, scheduler };
}

function resCapture() {
  let status = 0;
  let body: any = null;
  const headers: Record<string, string | string[]> = {};
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
    sendStream() {},
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
  };
}

describe("bundle-objects admin routes (integration)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    for (const model of Object.values(db) as any[]) {
      for (const fn of Object.values(model) as any[]) {
        if (typeof fn?.mockReset === "function") fn.mockReset();
      }
    }
  });

  it("GET /bundles/:bundleId/objects paginates with cursor and sort order", async () => {
    const { handlers, server, scheduler } = makeServer();
    const { registerBundleObjectsAdminRoutes } = await import(
      "../../src/routes/admin/bundle-objects.js"
    );
    registerBundleObjectsAdminRoutes(server, { scheduler });

    // First page: sortOrder 1
    db.bundleObject.findMany.mockResolvedValueOnce([
      {
        id: "bo1",
        bundleId: "B1",
        fileId: "f1",
        path: "a.txt",
        sortOrder: 1,
        required: false,
        addedAt: new Date().toISOString(),
        file: {
          id: "f1",
          key: "a.txt",
          size: BigInt(10),
          contentType: "text/plain",
          metadata: null,
          contentHash: "a".repeat(64),
          etag: null,
          updatedAt: new Date().toISOString(),
        },
      },
    ] as any[]);

    const hList = handlers.get("GET /bundles/:bundleId/objects")!;
    const rc1 = resCapture();
    await hList({ params: { bundleId: "B1" }, query: { limit: "1" }, headers: {} } as any, rc1.res);
    expect(rc1.status).toBe(200);
    expect(rc1.body?.items?.[0]?.bundleObject?.id).toBe("bo1");
    expect(typeof rc1.body?.nextCursor).toBe("string");
    // Ensure ordering used by DB call
    const args1 = db.bundleObject.findMany.mock.calls[0]?.[0] ?? {};
    expect(args1?.take).toBe(1);
    expect(args1?.orderBy?.[0]?.sortOrder).toBe("asc");
    expect(args1?.orderBy?.[1]?.id).toBe("asc");

    // Second page after cursor: sortOrder 2
    db.bundleObject.findMany.mockResolvedValueOnce([
      {
        id: "bo2",
        bundleId: "B1",
        fileId: "f2",
        path: "b.txt",
        sortOrder: 2,
        required: true,
        addedAt: new Date().toISOString(),
        file: {
          id: "f2",
          key: "b.txt",
          size: BigInt(20),
          contentType: "text/plain",
          metadata: null,
          contentHash: null,
          etag: "etag-2",
          updatedAt: new Date().toISOString(),
        },
      },
    ] as any[]);
    const rc2 = resCapture();
    await hList(
      {
        params: { bundleId: "B1" },
        query: { limit: "1", cursor: rc1.body?.nextCursor },
        headers: {},
      } as any,
      rc2.res,
    );
    expect(rc2.status).toBe(200);
    expect(rc2.body?.items?.[0]?.bundleObject?.id).toBe("bo2");
    const args2 = db.bundleObject.findMany.mock.calls[1]?.[0] ?? {};
    expect(Array.isArray(args2?.where?.AND)).toBe(true);
    // OR branch with sortOrder gt or (sortOrder eq and id gt)
    const or = args2?.where?.AND?.[1]?.OR;
    expect(Array.isArray(or)).toBe(true);
  });

  it("POST /bundles/:bundleId/objects defaults path and increments sortOrder; idempotent upsert", async () => {
    const { handlers, server, scheduler } = makeServer();
    const { registerBundleObjectsAdminRoutes } = await import(
      "../../src/routes/admin/bundle-objects.js"
    );
    registerBundleObjectsAdminRoutes(server, { scheduler });

    // No path provided for f1; should default to key; next sort base = 4
    db.file.findMany.mockResolvedValueOnce([
      { id: "f1", key: "k1.txt" },
      { id: "f2", key: "k2.txt" },
    ]);
    db.bundleObject.findFirst.mockResolvedValueOnce({ sortOrder: 4 });

    // upsert mock that echoes back create values
    (db.bundleObject.upsert as any).mockImplementation(async (args: any) => ({
      id: `bo-${args.create.fileId}`,
      bundleId: args.create.bundleId,
      fileId: args.create.fileId,
      path: args.create.path,
      sortOrder: args.create.sortOrder,
      required: args.create.required,
      addedAt: new Date().toISOString(),
    }));

    const hAttach = handlers.get("POST /bundles/:bundleId/objects")!;
    const rc = resCapture();
    await hAttach(
      {
        params: { bundleId: "B1" },
        body: { items: [{ fileId: "f1" }, { fileId: "f2", required: true }] },
        headers: {},
      } as any,
      rc.res,
    );
    expect(rc.status).toBe(201);
    // Verify DB call args for default path and sortOrder increments (5 then 6)
    const firstCall = (db.bundleObject.upsert as any).mock.calls[0]?.[0]?.create;
    const secondCall = (db.bundleObject.upsert as any).mock.calls[1]?.[0]?.create;
    expect(firstCall.path).toBe("k1.txt");
    expect(firstCall.sortOrder).toBe(5);
    expect(firstCall.required).toBe(false);
    expect(secondCall.sortOrder).toBe(6);
    expect(secondCall.required).toBe(true);
    expect(scheduler.schedule).toHaveBeenCalledWith("B1");
  });
});
