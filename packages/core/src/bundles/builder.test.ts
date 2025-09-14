import { describe, it, expect, vi, beforeEach } from "vitest";
import { Readable } from "node:stream";
import { buildBundleArtifact } from "./builder.js";

// Mock zip-stream with deterministic concatenation of entry data
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
      void collect();
    }
    finish(cb: () => void) {
      const buf = Buffer.concat(this.chunks);
      if (this._dst?.write) this._dst.write(buf);
      if (this._dst?.end) this._dst.end();
      cb();
    }
  }
  return { default: FakeZip } as any;
});

describe("buildBundleArtifact", () => {
  const db: any = {
    bundle: {
      findUnique: vi.fn(async (args?: any) => {
        // When computeBundleDigest selects bundleObjects, return them
        if (args && args.select && args.select.bundleObjects) {
          return {
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
          };
        }
        return { id: "B1", name: "B", bundleDigest: "prev" };
      }),
      update: vi.fn(async () => ({})),
    },
    bundleObject: {
      findMany: vi.fn(async () => [
        {
          fileId: "F1",
          path: "a.txt",
          sortOrder: 1,
          file: { id: "F1", key: "k1", storageKey: "s1" },
        },
        { fileId: "F2", path: null, sortOrder: 2, file: { id: "F2", key: "k2", storageKey: "s2" } },
      ]),
    },
  };

  function makeStorage() {
    const puts: Buffer[] = [];
    const storage = {
      getFileStream: vi.fn(async (key: string) => Readable.from(Buffer.from(`data:${key}`))),
      putFile: vi.fn(async ({ body }: { body: Buffer }) => {
        puts.push(Buffer.from(body));
        return {
          storageKey: "objects/sha256/zz/zz/zip",
          size: body.length,
          sha256: "ziphash",
          storageEtag: "zip-etag",
        };
      }),
    } as any;
    return { storage, puts };
  }

  beforeEach(() => {
    vi.restoreAllMocks();
    db.bundle.findUnique.mockClear();
    db.bundle.update.mockClear();
    db.bundleObject.findMany.mockClear();
  });

  it("produces deterministic zip content across runs", async () => {
    const { storage, puts } = makeStorage();
    const res1 = await buildBundleArtifact(db, storage, "B1", { force: true });
    expect(res1.status).toBe("built");
    // DB updated with pointers
    expect(db.bundle.update).toHaveBeenCalled();
    const upd1 = db.bundle.update.mock.calls[0]?.[0]?.data;
    expect(typeof upd1?.storagePath).toBe("string");
    expect(typeof upd1?.checksum).toBe("string");
    expect(typeof upd1?.bundleDigest).toBe("string");
    const first = Buffer.from(puts[0]);
    // Run again with force to avoid skip-by-digest
    const res2 = await buildBundleArtifact(db, storage, "B1", { force: true });
    expect(res2.status).toBe("built");
    const second = Buffer.from(puts[1]);
    expect(first.equals(second)).toBe(true);
  });
});
