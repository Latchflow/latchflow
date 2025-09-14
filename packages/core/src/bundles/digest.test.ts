import { describe, it, expect } from "vitest";
import { computeBundleDigest } from "./digest.js";

describe("computeBundleDigest", () => {
  it("produces stable digest over ordered items", async () => {
    const db = {
      bundle: {
        findUnique: async () => ({
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
        }),
      },
    } as any;
    const a = await computeBundleDigest(db, "B1");
    const b = await computeBundleDigest(db, "B1");
    expect(a.digest).toBe(b.digest);
    // Changing order changes digest
    const db2 = {
      bundle: {
        findUnique: async () => ({
          id: "B1",
          bundleObjects: [
            {
              fileId: "F2",
              path: null,
              required: false,
              sortOrder: 1,
              file: { id: "F2", contentHash: "h2" },
            },
            {
              fileId: "F1",
              path: "a.txt",
              required: true,
              sortOrder: 2,
              file: { id: "F1", contentHash: "h1" },
            },
          ],
        }),
      },
    } as any;
    const c = await computeBundleDigest(db2, "B1");
    expect(c.digest).not.toBe(a.digest);
  });
});
