import { describe, it, expect, vi, beforeEach } from "vitest";
import type { HttpHandler } from "../../http/http-server.js";

// Mock DB and builder
const db = {
  bundle: {
    findUnique: vi.fn(async () => null as any),
    update: vi.fn(async () => ({}) as any),
  },
};

vi.mock("../../db/db.js", () => ({ getDb: () => db }));

const storage = {} as any;
const scheduler = {
  schedule: vi.fn(async () => void 0),
  getStatus: vi.fn(() => ({ state: "idle" as const })),
} as any;

vi.mock("../../bundles/builder.js", () => ({
  buildBundleArtifact: vi.fn(async () => ({
    status: "built",
    storageKey: "objects/sha256/00/00/zip",
    checksum: "etag",
    size: 123,
    digest: "deadbeef",
  })),
}));

function makeServer() {
  const handlers = new Map<string, HttpHandler>();
  const server = {
    post: (p: string, h: HttpHandler) => handlers.set(`POST ${p}`, h),
    get: (p: string, h: HttpHandler) => handlers.set(`GET ${p}`, h),
  } as any;
  return { handlers, server };
}

// Allow through permission middleware
vi.mock("../../middleware/require-session.js", () => ({
  requireSession: vi.fn(async () => ({ user: { id: "u1", role: "ADMIN" } })),
}));

describe("admin bundle build routes (unit)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    db.bundle.findUnique.mockReset();
    db.bundle.update.mockReset();
  });

  it("POST /admin/bundles/:bundleId/build triggers build and returns result", async () => {
    const { handlers, server } = makeServer();
    const { registerBundleBuildAdminRoutes } = await import("./bundle-build.js");
    registerBundleBuildAdminRoutes(server, { storage, scheduler });
    db.bundle.findUnique.mockResolvedValueOnce({ id: "B1" });
    const h = handlers.get("POST /admin/bundles/:bundleId/build")!;
    let status = 0;
    let body: any = null;
    await h({ params: { bundleId: "B1" }, body: { force: true } } as any, {
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
    expect(status).toBe(202);
    expect(body?.status).toBe("queued");
    expect(scheduler.schedule).toHaveBeenCalledWith("B1", { force: true });
  });

  it("GET /admin/bundles/:bundleId/build/status returns bundle pointers", async () => {
    const { handlers, server } = makeServer();
    const { registerBundleBuildAdminRoutes } = await import("./bundle-build.js");
    scheduler.getStatus.mockReturnValueOnce({ state: "queued" });
    registerBundleBuildAdminRoutes(server, { storage, scheduler });
    db.bundle.findUnique.mockResolvedValueOnce({
      id: "B1",
      bundleDigest: "abcd",
      storagePath: "objects/sha256/..",
      checksum: "etag",
      updatedAt: new Date("2025-01-01T00:00:00.000Z"),
    } as any);
    const h = handlers.get("GET /admin/bundles/:bundleId/build/status")!;
    let status = 0;
    let body: any = null;
    await h({ params: { bundleId: "B1" } } as any, {
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
    expect(status).toBe(200);
    expect(body?.bundleId).toBe("B1");
    expect(body?.bundleDigest).toBe("abcd");
    expect(body?.status).toBe("queued");
  });
});
