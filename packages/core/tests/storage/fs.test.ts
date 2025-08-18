import { describe, it, expect } from "vitest";
import { createFsStorage } from "../../src/storage/fs.js";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

describe("storage/fs", () => {
  it("writes and reads from a temp base path", async () => {
    const base = await fs.promises.mkdtemp(path.join(os.tmpdir(), "lf-fs-"));
    try {
      const driver = await createFsStorage({ config: { basePath: base } });
      const bucket = "test";
      const key = "bundles/b2/file.bin";
      const data = Buffer.from("abc");
      await driver.put({ bucket, key, body: data, contentType: "application/octet-stream" });
      const head = await driver.head({ bucket, key });
      expect(head.size).toBe(3);
      const rs = await driver.getStream({ bucket, key });
      const chunks: Buffer[] = [];
      await new Promise<void>((resolve, reject) => {
        rs.on("data", (c: Buffer) => chunks.push(c));
        rs.on("end", () => resolve());
        rs.on("error", reject);
      });
      expect(Buffer.concat(chunks).toString()).toBe("abc");
      await driver.del({ bucket, key });
      await expect(driver.head({ bucket, key })).rejects.toBeTruthy();
    } finally {
      await fs.promises.rm(base, { recursive: true, force: true });
    }
  });
});
