import type { StorageDriver, StorageFactory } from "./types.js";

function resolveStorageFactory(mod: unknown): StorageFactory {
  const obj = mod as Record<string, unknown>;
  const def = obj.default;
  if (typeof def === "function") return def as StorageFactory;
  const create = obj.createStorage as unknown;
  if (typeof create === "function") return create as StorageFactory;
  throw new Error("Storage module does not export a factory");
}

export async function loadStorage(
  driver: string,
  pathOrNull: string | null,
  config: unknown,
): Promise<{ name: string; storage: StorageDriver }> {
  if (!driver || driver === "memory") {
    const { createMemoryStorage } = await import("./memory.js");
    return { name: "memory", storage: await createMemoryStorage({ config }) };
  }
  if (driver === "fs" && !pathOrNull) {
    const { createFsStorage } = await import("./fs.js");
    return { name: "fs", storage: await createFsStorage({ config }) };
  }
  if (driver === "s3" && !pathOrNull) {
    const { createS3Storage } = await import("./s3.js");
    return { name: "s3", storage: await createS3Storage({ config }) };
  }
  if (pathOrNull) {
    const mod = await import(pathOrNull);
    const factory = resolveStorageFactory(mod);
    return { name: driver, storage: await factory({ config }) };
  }
  const mod = await import("packages/plugins/storage/" + driver).catch(() => import(driver));
  const factory = resolveStorageFactory(mod);
  return { name: driver, storage: await factory({ config }) };
}
