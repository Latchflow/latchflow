import type { StorageDriver } from "./types.js";
import { createHash } from "node:crypto";
// import { Readable } from "node:stream";
import fs from "node:fs";

export type StorageService = ReturnType<typeof createStorageService>;

type ServiceDeps = {
  driver: StorageDriver;
  bucket: string;
  keyPrefix: string;
};

export function createStorageService(deps: ServiceDeps) {
  const keyFor = (bundleId: string, objectKey: string) =>
    [deps.keyPrefix, "bundles", bundleId, objectKey].filter(Boolean).join("/");

  const keyForHash = (sha256Hex: string) => {
    const a = sha256Hex.slice(0, 2) || "00";
    const b = sha256Hex.slice(2, 4) || "00";
    return [deps.keyPrefix, "objects", "sha256", a, b, sha256Hex]
      .filter((s) => s && s.length > 0)
      .join("/");
  };

  async function bufferFromStream(rs: NodeJS.ReadableStream): Promise<Buffer> {
    const chunks: Buffer[] = [];
    await new Promise<void>((resolve, reject) => {
      rs.on("data", (c: Buffer) => chunks.push(Buffer.from(c)));
      rs.on("end", () => resolve());
      rs.on("error", reject);
    });
    return Buffer.concat(chunks);
  }

  function sha256HexOf(buf: Buffer): string {
    return createHash("sha256").update(buf).digest("hex");
  }
  async function sha256HexFromPath(path: string): Promise<string> {
    const hash = createHash("sha256");
    await new Promise<void>((resolve, reject) => {
      const rs = fs.createReadStream(path);
      rs.on("error", reject);
      rs.on("end", () => resolve());
      rs.on("data", (chunk) => hash.update(chunk as Buffer));
    });
    return hash.digest("hex");
  }

  return {
    putBundleObject: async (
      bundleId: string,
      objectKey: string,
      body: Buffer | NodeJS.ReadableStream,
      contentType?: string,
    ) => {
      const key = keyFor(bundleId, objectKey);
      return deps.driver.put({ bucket: deps.bucket, key, body, contentType });
    },
    getBundleStream: async (bundleId: string, objectKey: string) => {
      const key = keyFor(bundleId, objectKey);
      return deps.driver.getStream({ bucket: deps.bucket, key });
    },
    headBundleObject: async (bundleId: string, objectKey: string) => {
      const key = keyFor(bundleId, objectKey);
      return deps.driver.head({ bucket: deps.bucket, key });
    },
    deleteBundleObject: async (bundleId: string, objectKey: string) => {
      const key = keyFor(bundleId, objectKey);
      await deps.driver.del({ bucket: deps.bucket, key });
    },
    // High-level helper used by actions (returns a portal URL, not a raw storage URL)
    createReleaseLink: async (args: {
      bundleId: string;
      recipientId: string;
      ttlSeconds?: number;
    }) => {
      const url = `/portal/bundles/${args.bundleId}?rid=${args.recipientId}`;
      const expiresAt = args.ttlSeconds
        ? new Date(Date.now() + args.ttlSeconds * 1000).toISOString()
        : undefined;
      return { url, expiresAt };
    },

    // File-level helpers (content-addressed by sha256)
    putFile: async (args: { body: Buffer | NodeJS.ReadableStream; contentType?: string }) => {
      const bodyBuf = Buffer.isBuffer(args.body) ? args.body : await bufferFromStream(args.body);
      const hash = sha256HexOf(bodyBuf);
      const storageKey = keyForHash(hash);
      const putRes = await deps.driver.put({
        bucket: deps.bucket,
        key: storageKey,
        body: bodyBuf, // pass Buffer so S3 driver can set ContentLength
        contentType: args.contentType,
      });
      const size = putRes.size ?? bodyBuf.length;
      const storageEtag = putRes.etag ?? hash;
      return { storageKey, size, sha256: hash, storageEtag };
    },
    // Stream-friendly path variant: compute hash from disk and stream to driver without buffering
    putFileFromPath: async (args: { path: string; contentType?: string }) => {
      const hash = await sha256HexFromPath(args.path);
      const storageKey = keyForHash(hash);
      const stat = await fs.promises.stat(args.path);
      const putRes = await deps.driver.put({
        bucket: deps.bucket,
        key: storageKey,
        body: fs.createReadStream(args.path),
        contentType: args.contentType,
      });
      const storageEtag = putRes.etag ?? hash;
      return { storageKey, size: Number(stat.size), sha256: hash, storageEtag };
    },
    // Expose key derivation for callers that precompute the hash
    contentAddressedKey: (sha256Hex: string) => keyForHash(sha256Hex),
    getFileStream: async (storageKey: string) => {
      return deps.driver.getStream({ bucket: deps.bucket, key: storageKey });
    },
    headFile: async (storageKey: string) => {
      return deps.driver.head({ bucket: deps.bucket, key: storageKey });
    },
    deleteFile: async (storageKey: string) => {
      try {
        await deps.driver.del({ bucket: deps.bucket, key: storageKey });
      } catch {
        // idempotent delete: ignore errors (e.g., not found)
      }
    },
    // Raw helpers and capability probes for advanced flows (e.g., presigned upload + commit)
    supportsSignedPut: typeof deps.driver.createSignedPutUrl === "function",
    tempUploadKey: (id: string) =>
      [deps.keyPrefix, "tmp", "uploads", id].filter((s) => s && s.length > 0).join("/"),
    createSignedPutUrl: async (args: {
      storageKey: string;
      contentType?: string;
      expiresSeconds?: number;
      headers?: Record<string, string>;
    }): Promise<{ url: string; headers?: Record<string, string>; expiresAt?: string }> => {
      if (typeof deps.driver.createSignedPutUrl !== "function") {
        throw Object.assign(new Error("Presigned PUT not supported"), { status: 501 });
      }
      return deps.driver.createSignedPutUrl({
        bucket: deps.bucket,
        key: args.storageKey,
        contentType: args.contentType,
        expiresSeconds: args.expiresSeconds,
        headers: args.headers,
      });
    },
    copyObjectRaw: async (args: {
      srcKey: string;
      destKey: string;
      metadata?: Record<string, string>;
      contentType?: string;
    }): Promise<{ etag?: string }> => {
      if (typeof deps.driver.copyObject === "function") {
        return deps.driver.copyObject({
          bucket: deps.bucket,
          srcKey: args.srcKey,
          destKey: args.destKey,
          metadata: args.metadata,
          contentType: args.contentType,
        });
      }
      // Fallback: stream copy (avoid buffering in memory)
      const rs = await deps.driver.getStream({ bucket: deps.bucket, key: args.srcKey });
      const putRes = await deps.driver.put({
        bucket: deps.bucket,
        key: args.destKey,
        body: rs,
        contentType: args.contentType,
        metadata: args.metadata,
      });
      return { etag: putRes.etag };
    },
    headRaw: async (storageKey: string) =>
      deps.driver.head({ bucket: deps.bucket, key: storageKey }),
  };
}
