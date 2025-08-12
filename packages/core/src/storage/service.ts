import type { StorageDriver } from "./types.js";

export type StorageService = ReturnType<typeof createStorageService>;

type ServiceDeps = {
  driver: StorageDriver;
  bucket: string;
  keyPrefix: string;
};

export function createStorageService(deps: ServiceDeps) {
  const keyFor = (bundleId: string, objectKey: string) =>
    [deps.keyPrefix, "bundles", bundleId, objectKey].filter(Boolean).join("/");

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
  };
}
