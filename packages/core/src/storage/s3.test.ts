import { describe, it, expect, vi, beforeEach } from "vitest";
import { Readable } from "node:stream";

// Mock AWS SDK v3 modules used via dynamic import in s3.ts
let bucketExists = false;

class PutObjectCommand {
  constructor(public input: Record<string, unknown>) {}
}
class GetObjectCommand {
  constructor(public input: Record<string, unknown>) {}
}
class HeadObjectCommand {
  constructor(public input: Record<string, unknown>) {}
}
class DeleteObjectCommand {
  constructor(public input: Record<string, unknown>) {}
}
class CopyObjectCommand {
  constructor(public input: Record<string, unknown>) {}
}
class HeadBucketCommand {
  constructor(public input: Record<string, unknown>) {}
}
class CreateBucketCommand {
  constructor(public input: Record<string, unknown>) {}
}

class S3Client {
  /* eslint-disable @typescript-eslint/no-unused-vars */
  constructor(_cfg: Record<string, unknown>) {}
  /* eslint-enable @typescript-eslint/no-unused-vars */
  async send(cmd: unknown): Promise<Record<string, unknown>> {
    if (cmd instanceof HeadBucketCommand) {
      if (!bucketExists) {
        const err: Record<string, unknown> = new Error("NotFound") as unknown as Record<
          string,
          unknown
        >;
        (err as any).$metadata = { httpStatusCode: 404 };
        throw err as unknown as Error;
      }
      return {};
    }
    if (cmd instanceof CreateBucketCommand) {
      bucketExists = true;
      return {};
    }
    if (cmd instanceof PutObjectCommand) {
      return { ETag: '"etag-put"' };
    }
    if (cmd instanceof GetObjectCommand) {
      return { Body: Readable.from(Buffer.from("xyz")) } as unknown as Record<string, unknown>;
    }
    if (cmd instanceof HeadObjectCommand) {
      const hex = "a".repeat(64);
      const b64 = Buffer.from(hex, "hex").toString("base64");
      return {
        ContentLength: 3,
        ContentType: "text/plain",
        ETag: '"abc"',
        ChecksumSHA256: b64,
        Metadata: { x: "1" },
      } as unknown as Record<string, unknown>;
    }
    if (cmd instanceof DeleteObjectCommand) {
      return {};
    }
    if (cmd instanceof CopyObjectCommand) {
      return { CopyObjectResult: { ETag: '"copy-etag"' } } as unknown as Record<string, unknown>;
    }
    return {};
  }
}

vi.mock("@aws-sdk/client-s3", () => ({
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
  CopyObjectCommand,
  HeadBucketCommand,
  CreateBucketCommand,
}));

const getSignedUrl = vi.fn(async () => "https://example.com/signed");
vi.mock("@aws-sdk/s3-request-presigner", () => ({ getSignedUrl }));

describe("storage/s3", () => {
  beforeEach(() => {
    bucketExists = false;
    getSignedUrl.mockClear();
  });

  it("supports put/get/head/del/copy with dynamic client", async () => {
    const { createS3Storage } = await import("./s3.js");
    const driver = await createS3Storage({ config: { ensureBucket: true } });
    const bucket = "b";
    const key = "k";
    const put = await driver.put({
      bucket,
      key,
      body: Buffer.from("xyz"),
      contentType: "text/plain",
    });
    expect(put.etag).toBe("etag-put");

    const head = await driver.head({ bucket, key });
    expect(head.size).toBe(3);
    expect(head.contentType).toBe("text/plain");
    expect(head.etag).toBe("abc");
    expect(head.checksumSha256Hex).toHaveLength(64);
    expect(head.metadata?.x).toBe("1");

    const rs = await driver.getStream({ bucket, key });
    const chunks: Buffer[] = [];
    await new Promise<void>((resolve, reject) => {
      rs.on("data", (c: Buffer) => chunks.push(Buffer.from(c)));
      rs.on("end", resolve);
      rs.on("error", reject);
    });
    expect(Buffer.concat(chunks).toString("utf8")).toBe("xyz");

    const copy = await driver.copyObject?.({
      bucket,
      srcKey: key,
      destKey: "k2",
      contentType: "text/plain",
    });
    expect(copy?.etag).toBe("copy-etag");

    await driver.del({ bucket, key });
  });

  it("creates signed urls for get and put", async () => {
    const { createS3Storage } = await import("./s3.js");
    const driver = await createS3Storage({ config: {} });
    const urlGet = await driver.createSignedGetUrl?.({ bucket: "b", key: "k", expiresSeconds: 60 });
    expect(urlGet).toContain("signed");
    const put = await driver.createSignedPutUrl?.({
      bucket: "b",
      key: "k",
      contentType: "text/plain",
      expiresSeconds: 60,
      headers: { a: "1" },
    });
    expect(put?.url).toContain("signed");
    expect(put?.headers?.a).toBe("1");
    expect(getSignedUrl).toHaveBeenCalled();
  });
});
