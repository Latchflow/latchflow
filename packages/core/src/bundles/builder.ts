import { PassThrough } from "node:stream";
import type { DbClient } from "../db/db.js";
import type { StorageService } from "../storage/service.js";
import { computeBundleDigest } from "./digest.js";

type ZipLike = {
  pipe(dst: NodeJS.WritableStream): void;
  entry(
    source: NodeJS.ReadableStream | Buffer,
    options: { name: string; store?: boolean; date?: Date },
    cb: (err: Error | null) => void,
  ): void;
  finish(cb: () => void): void;
};

async function createZip(): Promise<ZipLike> {
  const mod = (await import("zip-stream")) as unknown;
  // CJS default export or constructor
  const Ctor = ((mod as { default?: new () => ZipLike }).default ??
    (mod as unknown as new () => ZipLike)) as (new () => ZipLike) | undefined;
  if (!Ctor) throw new Error("zip-stream not available");
  return new Ctor();
}

export type BuildResult =
  | { status: "skipped"; reason: "unchanged" }
  | {
      status: "built";
      storageKey: string;
      checksum: string;
      size: number;
      digest: string;
    };

export async function buildBundleArtifact(
  db: DbClient,
  storage: StorageService,
  bundleId: string,
  opts: { force?: boolean } = {},
): Promise<BuildResult> {
  const b = await db.bundle.findUnique({
    where: { id: bundleId },
    select: { id: true, name: true, bundleDigest: true },
  });
  if (!b) throw new Error("Bundle not found");

  const { digest } = await computeBundleDigest(db, bundleId);
  if (!opts.force && b.bundleDigest && b.bundleDigest === digest) {
    return { status: "skipped", reason: "unchanged" } as const;
  }

  // Build deterministic zip in-memory. For now use store=true (no compression)
  // to keep output deterministic across environments.
  const zip = await createZip();
  const out = new PassThrough();
  const buffers: Buffer[] = [];
  const collecting = new Promise<Buffer>((resolve, reject) => {
    out.on("data", (c: Buffer) => buffers.push(Buffer.from(c)));
    out.on("end", () => resolve(Buffer.concat(buffers)));
    out.on("error", reject);
  });
  zip.pipe(out);

  // Resolve file entry name using BundleObject.path || File.key || File.id
  // Fetch file keys/storage keys in the same order
  type Row = {
    fileId: string;
    path: string | null;
    sortOrder: number;
    file: { id: string; key: string; storageKey: string } | null;
  };
  const rows = (await db.bundleObject.findMany({
    where: { bundleId, isEnabled: true },
    orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
    select: {
      fileId: true,
      path: true,
      sortOrder: true,
      file: { select: { id: true, key: true, storageKey: true } },
    },
  })) as unknown as Row[];

  for (const row of rows) {
    const f = row.file;
    if (!f || !f.storageKey) continue; // skip missing
    const name = row.path ?? f.key ?? f.id;
    // Stream file into zip entry
    const fileStream: NodeJS.ReadableStream = await storage.getFileStream(f.storageKey);
    await new Promise<void>((resolve, reject) => {
      zip.entry(fileStream, { name, store: true, date: new Date(0) }, (err: Error | null) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  await new Promise<void>((resolve) => zip.finish(() => resolve()));
  const zipBuffer = await collecting;

  const put = await storage.putFile({ body: zipBuffer, contentType: "application/zip" });

  // Atomic pointer update + digest set
  await db.bundle.update({
    where: { id: bundleId },
    data: {
      storagePath: put.storageKey,
      checksum: put.storageEtag ?? put.sha256,
      bundleDigest: digest,
    },
  });

  return {
    status: "built",
    storageKey: put.storageKey,
    checksum: put.storageEtag ?? put.sha256,
    size: put.size,
    digest,
  } as const;
}
