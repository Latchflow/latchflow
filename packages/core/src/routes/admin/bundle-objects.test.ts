import { describe, it, expect, vi, beforeEach } from "vitest";
import type { HttpHandler } from "../../http/http-server.js";

// Mock DB client
const db = {
  bundleObject: {
    findMany: vi.fn(async () => []),
    findFirst: vi.fn(async () => null),
    findUnique: vi.fn(async () => null),
    upsert: vi.fn(async () => ({})),
    update: vi.fn(async () => ({})),
    deleteMany: vi.fn(async () => ({})),
  },
  file: {
    findMany: vi.fn(async () => []),
  },
};
vi.mock("../../db/db.js", () => ({ getDb: () => db }));

// requirePermission path uses requireSession under the hood — mock it to allow admin
vi.mock("../../middleware/require-session.js", () => ({
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

describe("bundle-objects admin routes", () => {
  beforeEach(() => {
    Object.values(db.bundleObject).forEach((fn: any) => fn?.mockClear?.());
    Object.values(db.file).forEach((fn: any) => fn?.mockClear?.());
  });

  it("GET /bundles/:bundleId/objects lists with file metadata and cursor", async () => {
    const { handlers, server, scheduler } = makeServer();
    const { registerBundleObjectsAdminRoutes } = await import("./bundle-objects.js");
    registerBundleObjectsAdminRoutes(server, { scheduler });
    const now = new Date().toISOString();
    (db.bundleObject.findMany as any).mockResolvedValueOnce([
      {
        id: "bo1",
        bundleId: "11111111-1111-1111-1111-111111111111",
        fileId: "f1",
        path: "docs/a.txt",
        sortOrder: 1,
        required: false,
        addedAt: now,
        file: {
          id: "f1",
          key: "docs/a.txt",
          size: BigInt(10),
          contentType: "text/plain",
          metadata: { lang: "en" },
          contentHash: "a".repeat(64),
          etag: null,
          updatedAt: now,
        },
      },
      {
        id: "bo2",
        bundleId: "11111111-1111-1111-1111-111111111111",
        fileId: "f2",
        path: null,
        sortOrder: 2,
        required: true,
        addedAt: now,
        file: {
          id: "f2",
          key: "docs/b.txt",
          size: BigInt(20),
          contentType: "text/plain",
          metadata: null,
          contentHash: null,
          etag: "etag-2",
          updatedAt: now,
        },
      },
    ]);
    const h = handlers.get("GET /bundles/:bundleId/objects")!;
    const rc = resCapture();
    await h(
      {
        params: { bundleId: "11111111-1111-1111-1111-111111111111" },
        query: { limit: "2" },
        headers: {},
      } as any,
      rc.res,
    );
    expect(rc.status).toBe(200);
    expect(rc.body?.items?.length).toBe(2);
    expect(rc.body?.items?.[0]?.bundleObject?.id).toBe("bo1");
    expect(rc.body?.items?.[0]?.file?.key).toBe("docs/a.txt");
    expect(rc.body?.nextCursor).toBeTruthy();
  });

  it("POST /bundles/:bundleId/objects attaches items idempotently and schedules rebuild", async () => {
    const { handlers, server, scheduler } = makeServer();
    const { registerBundleObjectsAdminRoutes } = await import("./bundle-objects.js");
    registerBundleObjectsAdminRoutes(server, { scheduler });
    // Missing-path items fetch file keys
    (db.file.findMany as any).mockResolvedValueOnce([
      { id: "f1", key: "k1.txt" },
      { id: "f2", key: "k2.txt" },
    ]);
    // Next sortOrder base
    (db.bundleObject.findFirst as any).mockResolvedValueOnce({ sortOrder: 4 });
    // upsert returns created rows; duplicate handled by upsert returning existing
    let call = 0;
    (db.bundleObject.upsert as any).mockImplementation(async (args: any) => {
      call += 1;
      return {
        id: `bo${call}`,
        bundleId: args.create.bundleId,
        fileId: args.create.fileId,
        path: args.create.path,
        sortOrder: args.create.sortOrder,
        required: args.create.required,
        addedAt: new Date().toISOString(),
      };
    });
    const h = handlers.get("POST /bundles/:bundleId/objects")!;
    const rc = resCapture();
    await h(
      {
        params: { bundleId: "11111111-1111-1111-1111-111111111111" },
        body: {
          items: [{ fileId: "f1" }, { fileId: "f2", path: "custom/name.txt", required: true }],
        },
        headers: {},
      } as any,
      rc.res,
    );
    expect(rc.status).toBe(201);
    expect(rc.body?.items?.length).toBe(2);
    expect(scheduler.schedule).toHaveBeenCalledWith("11111111-1111-1111-1111-111111111111");
    expect(db.bundleObject.upsert).toHaveBeenCalledTimes(2);
  });

  it("PATCH /bundles/:bundleId/objects/:id updates fields and schedules rebuild", async () => {
    const { handlers, server, scheduler } = makeServer();
    const { registerBundleObjectsAdminRoutes } = await import("./bundle-objects.js");
    registerBundleObjectsAdminRoutes(server, { scheduler });
    (db.bundleObject.findUnique as any).mockResolvedValueOnce({
      bundleId: "11111111-1111-1111-1111-111111111111",
    });
    const h = handlers.get("POST /bundles/:bundleId/objects/:id")!;
    const rc = resCapture();
    await h(
      {
        params: {
          bundleId: "11111111-1111-1111-1111-111111111111",
          id: "22222222-2222-2222-2222-222222222222",
        },
        body: { path: "renamed.txt", sortOrder: 9, required: true, isEnabled: false },
        headers: {},
      } as any,
      rc.res,
    );
    expect(rc.status).toBe(204);
    expect(db.bundleObject.update).toHaveBeenCalled();
    const callArg = (db.bundleObject.update as any).mock.calls[0][0];
    expect(callArg.where.id).toBe("22222222-2222-2222-2222-222222222222");
    expect(callArg.data.path).toBe("renamed.txt");
    expect(callArg.data.sortOrder).toBe(9);
    expect(callArg.data.required).toBe(true);
    expect(scheduler.schedule).toHaveBeenCalledWith("11111111-1111-1111-1111-111111111111");
  });

  it("DELETE /bundles/:bundleId/objects/:id detaches and schedules rebuild", async () => {
    const { handlers, server, scheduler } = makeServer();
    const { registerBundleObjectsAdminRoutes } = await import("./bundle-objects.js");
    registerBundleObjectsAdminRoutes(server, { scheduler });
    const h = handlers.get("DELETE /bundles/:bundleId/objects/:id")!;
    const rc = resCapture();
    await h(
      {
        params: {
          bundleId: "11111111-1111-1111-1111-111111111111",
          id: "22222222-2222-2222-2222-222222222222",
        },
        headers: {},
      } as any,
      rc.res,
    );
    expect(rc.status).toBe(204);
    expect(db.bundleObject.deleteMany).toHaveBeenCalledWith({
      where: {
        id: "22222222-2222-2222-2222-222222222222",
        bundleId: "11111111-1111-1111-1111-111111111111",
      },
    });
    expect(scheduler.schedule).toHaveBeenCalledWith("11111111-1111-1111-1111-111111111111");
  });
});
