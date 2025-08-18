import { describe, it, expect } from "vitest";
import { createMemoryStorage } from "../../src/storage/memory.js";

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
});
