import { Readable } from "node:stream";
import type { StorageDriver, StorageFactory } from "./types.js";

type Entry = { data: Buffer; contentType?: string; metadata?: Record<string, string> };

export const createMemoryStorage: StorageFactory = async () => {
  const store = new Map<string, Entry>();
  const keyOf = (bucket: string, key: string) => `${bucket}:${key}`;

  const driver: StorageDriver = {
    async put({ bucket, key, body, contentType, metadata }) {
      const chunks: Buffer[] = [];
      if (Buffer.isBuffer(body)) {
        chunks.push(body);
      } else {
        await new Promise<void>((resolve, reject) => {
          body.on("data", (c: Buffer) => chunks.push(c));
          body.on("end", () => resolve());
          body.on("error", reject);
        });
      }
      const data = Buffer.concat(chunks);
      store.set(keyOf(bucket, key), { data, contentType, metadata });
      return { size: data.length };
    },
    async getStream({ bucket, key }) {
      const entry = store.get(keyOf(bucket, key));
      if (!entry) throw Object.assign(new Error("NotFound"), { status: 404 });
      return Readable.from(entry.data);
    },
    async head({ bucket, key }) {
      const entry = store.get(keyOf(bucket, key));
      if (!entry) throw Object.assign(new Error("NotFound"), { status: 404 });
      return { size: entry.data.length, contentType: entry.contentType, metadata: entry.metadata };
    },
    async del({ bucket, key }) {
      store.delete(keyOf(bucket, key));
    },
  };

  return driver;
};
