import fs from "node:fs";
import path from "node:path";
import type { StorageDriver, StorageFactory } from "./types.js";

export const createFsStorage: StorageFactory = async ({ config }) => {
  const cfg = (config as { basePath?: string } | null) ?? {};
  const basePath = cfg.basePath ?? "./.data/storage";
  await fs.promises.mkdir(basePath, { recursive: true });

  function filePath(bucket: string, key: string) {
    const full = path.join(basePath, bucket, key);
    const dir = path.dirname(full);
    return { full, dir };
  }

  const driver: StorageDriver = {
    async put({ bucket, key, body, contentType }) {
      const { full, dir } = filePath(bucket, key);
      await fs.promises.mkdir(dir, { recursive: true });
      const ws = fs.createWriteStream(full);
      await new Promise<void>((resolve, reject) => {
        ws.on("finish", resolve);
        ws.on("error", reject);
        if (Buffer.isBuffer(body)) {
          ws.end(body);
        } else {
          body.pipe(ws);
        }
      });
      const stat = await fs.promises.stat(full);
      // Persist contentType via sidecar file for MVP
      if (contentType) await fs.promises.writeFile(full + ".ct", contentType, "utf8");
      return { size: stat.size };
    },
    async getStream({ bucket, key }) {
      const { full } = filePath(bucket, key);
      return fs.createReadStream(full);
    },
    async head({ bucket, key }) {
      const { full } = filePath(bucket, key);
      const stat = await fs.promises.stat(full);
      let contentType: string | undefined;
      try {
        contentType = await fs.promises.readFile(full + ".ct", "utf8");
      } catch {
        contentType = undefined;
      }
      return { size: stat.size, contentType };
    },
    async del({ bucket, key }) {
      const { full } = filePath(bucket, key);
      await fs.promises.unlink(full).catch(() => void 0);
      await fs.promises.unlink(full + ".ct").catch(() => void 0);
    },
  };

  return driver;
};
