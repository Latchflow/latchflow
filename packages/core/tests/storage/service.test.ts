import { describe, it, expect } from "vitest";
import { createStorageService } from "../../src/storage/service.js";

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
});
