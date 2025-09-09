import { describe, it, expect } from "vitest";
import { createMemoryStorage } from "../storage/memory.js";

describe("storage/memory", () => {
  it("puts, heads, streams, and deletes objects", async () => {
    const driver = await createMemoryStorage({ config: null });
    const bucket = "test-bucket";
    const key = "bundles/b1/file.txt";
    const body = Buffer.from("hello");

    const putRes = await driver.put({ bucket, key, body, contentType: "text/plain" });
    expect(putRes.size).toBe(5);

    const head = await driver.head({ bucket, key });
    expect(head.size).toBe(5);

    const stream = await driver.getStream({ bucket, key });
    const chunks: Buffer[] = [];
    await new Promise<void>((resolve, reject) => {
      stream.on("data", (c: Buffer) => chunks.push(c));
      stream.on("end", () => resolve());
      stream.on("error", reject);
    });
    expect(Buffer.concat(chunks).toString()).toBe("hello");

    await driver.del({ bucket, key });
    await expect(driver.getStream({ bucket, key })).rejects.toBeTruthy();
  });

  it("copyObject duplicates bytes and supports overrides", async () => {
    const driver = await createMemoryStorage({ config: null });
    const bucket = "b";
    const srcKey = "src/file.txt";
    const destKey = "dest/file.txt";

    await driver.put({
      bucket,
      key: srcKey,
      body: Buffer.from("copy-me"),
      contentType: "text/plain",
      metadata: { a: "1" },
    });
    // Copy with overrides
    await driver.copyObject?.({
      bucket,
      srcKey,
      destKey,
      contentType: "text/markdown",
      metadata: { b: "2" },
    });

    const hSrc = await driver.head({ bucket, key: srcKey });
    const hDst = await driver.head({ bucket, key: destKey });
    expect(hSrc.size).toBe(7);
    expect(hDst.size).toBe(7);
    expect(hSrc.contentType).toBe("text/plain");
    expect(hDst.contentType).toBe("text/markdown");
    expect(hSrc.metadata).toEqual({ a: "1" });
    expect(hDst.metadata).toEqual({ b: "2" });

    const rs = await driver.getStream({ bucket, key: destKey });
    const chunks: Buffer[] = [];
    await new Promise<void>((resolve, reject) => {
      rs.on("data", (c: Buffer) => chunks.push(c));
      rs.on("end", () => resolve());
      rs.on("error", reject);
    });
    expect(Buffer.concat(chunks).toString()).toBe("copy-me");
  });
});
