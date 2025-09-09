import { describe, it, expect } from "vitest";
import { createStorageService } from "../storage/service.js";
import { createMemoryStorage } from "../storage/memory.js";
import { Readable } from "node:stream";

describe("storage service", () => {
  it("wraps driver with bundle-aware helpers", async () => {
    const ops: any[] = [];
    const driver = {
      put: async (args: any) => {
        ops.push(["put", args]);
        return { size: 3 };
      },
      getStream: async (args: any) => {
        ops.push(["get", args]);
        return new (require("stream").Readable)({
          read() {
            this.push(null);
          },
        });
      },
      head: async (args: any) => {
        ops.push(["head", args]);
        return { size: 3 };
      },
      del: async (args: any) => {
        ops.push(["del", args]);
      },
    } as any;
    const svc = createStorageService({ driver, bucket: "b", keyPrefix: "pref" });
    await svc.putBundleObject("B1", "file.txt", Buffer.from("abc"), "text/plain");
    await svc.headBundleObject("B1", "file.txt");
    await svc.getBundleStream("B1", "file.txt");
    await svc.deleteBundleObject("B1", "file.txt");
    expect(ops.map((o) => o[0])).toEqual(["put", "head", "get", "del"]);
    const link = await svc.createReleaseLink({ bundleId: "B1", recipientId: "R1", ttlSeconds: 60 });
    expect(link.url).toContain("/portal/bundles/B1");
    expect(link.expiresAt).toBeTruthy();
  });

  it("provides file-level helpers with content-addressed keys and etags", async () => {
    const driver = await createMemoryStorage({ config: null });
    const svc = createStorageService({ driver, bucket: "bkt", keyPrefix: "pref" });
    const buf = Buffer.from("hello-world");

    const put1 = await svc.putFile({ body: buf, contentType: "text/plain" });
    expect(put1.storageKey.startsWith("pref/objects/sha256/")).toBe(true);
    expect(put1.size).toBe(buf.length);
    expect(put1.sha256).toHaveLength(64);
    expect(put1.storageEtag).toBeTruthy();

    const head1 = await svc.headFile(put1.storageKey);
    expect(head1.size).toBe(buf.length);
    expect(head1.contentType).toBe("text/plain");

    // duplicate upload should yield same key
    const put2 = await svc.putFile({ body: Readable.from(buf), contentType: "text/plain" });
    expect(put2.storageKey).toBe(put1.storageKey);
    expect(put2.sha256).toBe(put1.sha256);

    // get stream and check bytes
    const rs = await svc.getFileStream(put1.storageKey);
    const bytes: Buffer[] = [];
    await new Promise<void>((resolve, reject) => {
      rs.on("data", (c: Buffer) => bytes.push(c));
      rs.on("end", resolve);
      rs.on("error", reject);
    });
    expect(Buffer.concat(bytes).toString("utf8")).toBe("hello-world");

    // delete is idempotent
    await svc.deleteFile(put1.storageKey);
    await svc.deleteFile(put1.storageKey);
  });
});
