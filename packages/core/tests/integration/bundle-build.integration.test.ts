import { describe, it, expect, vi, beforeEach } from "vitest";
import type { HttpHandler } from "../../src/http/http-server.js";
import { Readable } from "node:stream";
import { createBundleRebuildScheduler } from "../../src/bundles/scheduler.js";

// Mock zip-stream to avoid real zipping in integration test
vi.mock("zip-stream", () => {
  class FakeZip {
    private chunks: Buffer[] = [];
    pipe(dst: any) {
      this._dst = dst;
    }
    entry(src: any, _opts: any, cb: (err: Error | null) => void) {
      const collect = async () => {
        if (Buffer.isBuffer(src)) this.chunks.push(Buffer.from(src));
        else
          await new Promise<void>((resolve) => {
            src.on("data", (b: Buffer) => this.chunks.push(Buffer.from(b)));
            src.on("end", resolve);
          });
        cb(null);
      };
      collect();
    }
    finish(cb: () => void) {
      const buf = Buffer.concat(this.chunks);
      if (this._dst && typeof this._dst.write === "function") this._dst.write(buf);
      if (this._dst && typeof this._dst.end === "function") this._dst.end();
      cb();
    }
  }
  return { default: FakeZip } as any;
});

const db = {
  bundle: {
    findUnique: vi.fn(async (): Promise<any> => null),
    update: vi.fn(async (args: any): Promise<any> => ({ ...args?.data })),
  },
  bundleObject: {
    findMany: vi.fn(async (): Promise<any[]> => []),
  },
};
vi.mock("../../src/db/db.js", () => ({ getDb: () => db }));

function makeServer() {
  const handlers = new Map<string, HttpHandler>();
  const storage = {
    getFileStream: vi.fn(async (key: string) => Readable.from(Buffer.from(`data:${key}`))),
    putFile: vi.fn(async ({ body }: { body: Buffer }) => ({
      storageKey: "objects/sha256/zz/zz/zip",
      size: body.length,
      sha256: "ziphash",
      storageEtag: "zip-etag",
    })),
  } as any;
  const server = {
    post: (p: string, h: HttpHandler) => handlers.set(`POST ${p}`, h),
    get: (p: string, h: HttpHandler) => handlers.set(`GET ${p}`, h),
  } as any;
  return { handlers, storage, server };
}

// Pass permission middleware
vi.mock("../../src/middleware/require-session.js", () => ({
  requireSession: vi.fn(async () => ({ user: { id: "u1", role: "ADMIN" } })),
}));

describe("bundle build (integration)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    for (const model of Object.values(db) as any[]) {
      for (const fn of Object.values(model) as any[]) {
        if (typeof fn?.mockReset === "function") fn.mockReset();
      }
    }
  });

  it("builds and updates bundle pointers", async () => {
    const { handlers, server, storage } = makeServer();
    const { registerBundleBuildAdminRoutes } = await import(
      "../../src/routes/admin/bundle-build.js"
    );
    const scheduler = createBundleRebuildScheduler({ db: db as any, storage, debounceMs: 0 });
    registerBundleBuildAdminRoutes(server, { storage, scheduler });
    // First call from route parameter validation; second from digest computation
    db.bundle.findUnique.mockResolvedValueOnce({ id: "B1", bundleDigest: "prev" });
    db.bundle.findUnique.mockResolvedValueOnce({
      id: "B1",
      bundleObjects: [
        {
          fileId: "F1",
          path: "a.txt",
          required: true,
          sortOrder: 1,
          file: { id: "F1", contentHash: "h1" },
        },
        {
          fileId: "F2",
          path: null,
          required: false,
          sortOrder: 2,
          file: { id: "F2", contentHash: "h2" },
        },
      ],
    } as any);
    db.bundleObject.findMany.mockResolvedValueOnce([
      {
        fileId: "F1",
        path: "a.txt",
        sortOrder: 1,
        file: { id: "F1", key: "k1", storageKey: "s1", contentHash: "h1" },
      },
      {
        fileId: "F2",
        path: null,
        sortOrder: 2,
        file: { id: "F2", key: "k2", storageKey: "s2", contentHash: "h2" },
      },
    ]);
    const h = handlers.get("POST /admin/bundles/:bundleId/build")!;
    let status = 0;
    let body: any = null;
    await h({ params: { bundleId: "B1" }, body: {} } as any, {
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
    // allow scheduled task to run; poll a few times to reduce flake
    for (let i = 0; i < 50 && db.bundle.update.mock.calls.length === 0; i++) {
      // short sleep
      // eslint-disable-next-line no-await-in-loop
      await new Promise((r) => setTimeout(r, 5));
    }
    // Ensure bundle update called with new pointers
    const upd = db.bundle.update.mock.calls[0]?.[0]?.data;
    expect(upd?.storagePath).toBe("objects/sha256/zz/zz/zip");
    expect(upd?.checksum).toBe("zip-etag");
    expect(typeof upd?.bundleDigest).toBe("string");
  }, 10_000);
});
