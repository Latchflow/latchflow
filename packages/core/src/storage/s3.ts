// Lightweight S3 driver with dynamic imports to avoid hard deps during tests
// Implements core operations and presign/copy capabilities when AWS SDK v3 is available.
import type { StorageDriver, StorageFactory } from "./types.js";

type S3Deps = {
  region?: string;
  endpoint?: string;
  forcePathStyle?: boolean;
  accessKeyId?: string;
  secretAccessKey?: string;
  ensureBucket?: boolean;
};

type S3ClientLike = { send(command: unknown): Promise<unknown> };
type Ctor<T> = new (...args: unknown[]) => T;
type S3ModuleLike = {
  S3Client?: Ctor<S3ClientLike>;
  PutObjectCommand?: Ctor<unknown>;
  GetObjectCommand?: Ctor<unknown>;
  HeadObjectCommand?: Ctor<unknown>;
  DeleteObjectCommand?: Ctor<unknown>;
  CopyObjectCommand?: Ctor<unknown>;
  HeadBucketCommand?: Ctor<unknown>;
  CreateBucketCommand?: Ctor<unknown>;
};

async function importClientModule(): Promise<S3ModuleLike | null> {
  try {
    const mod = (await import("@aws-sdk/client-s3")) as unknown;
    return mod as S3ModuleLike;
  } catch {
    return null;
  }
}

async function importPresignModule(): Promise<{
  getSignedUrl?: (
    client: S3ClientLike,
    command: unknown,
    opts: { expiresIn?: number },
  ) => Promise<string>;
} | null> {
  try {
    const mod = (await import("@aws-sdk/s3-request-presigner")) as unknown;
    return mod as {
      getSignedUrl?: (
        client: S3ClientLike,
        command: unknown,
        opts: { expiresIn?: number },
      ) => Promise<string>;
    };
  } catch {
    return null;
  }
}

async function makeClient(cfg: S3Deps): Promise<{ client: S3ClientLike; mod: S3ModuleLike }> {
  const mod = await importClientModule();
  if (!mod || typeof mod.S3Client !== "function") throw new Error("AWS SDK for S3 not installed");
  const creds: Record<string, unknown> =
    cfg.accessKeyId && cfg.secretAccessKey
      ? { credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey } }
      : {};
  const endpoint: Record<string, unknown> = cfg.endpoint ? { endpoint: cfg.endpoint } : {};
  const forcePathStyle: Record<string, unknown> = cfg.forcePathStyle
    ? { forcePathStyle: true }
    : {};
  const region: Record<string, unknown> = { region: cfg.region ?? "us-east-1" };
  const Ctor = mod.S3Client as Ctor<S3ClientLike>;
  const client = new Ctor({ ...region, ...endpoint, ...forcePathStyle, ...creds });
  return { client, mod };
}

function b64ToHex(b64: string | undefined): string | undefined {
  if (!b64) return undefined;
  try {
    const buf = Buffer.from(b64, "base64");
    return buf.toString("hex");
  } catch {
    return undefined;
  }
}

async function ensureBucket(
  client: S3ClientLike,
  mod: S3ModuleLike,
  bucket: string,
): Promise<void> {
  if (typeof mod.HeadBucketCommand !== "function") return;
  const HeadBucketCommand = mod.HeadBucketCommand as Ctor<unknown>;
  const CreateBucketCommand = mod.CreateBucketCommand as Ctor<unknown> | undefined;
  try {
    await client.send(new HeadBucketCommand({ Bucket: bucket }));
  } catch (e) {
    const err = e as Record<string, unknown>;
    const meta = (err?.$metadata as Record<string, unknown> | undefined) ?? undefined;
    const code =
      (meta?.httpStatusCode as number | undefined) ??
      (err?.name as string | undefined) ??
      (err?.Code as string | undefined);
    if (code === 404 || code === "NotFound" || String(code) === "404") {
      try {
        if (CreateBucketCommand) {
          await client.send(new CreateBucketCommand({ Bucket: bucket }));
        }
      } catch {
        // ignore create errors if bucket already created by race
      }
    } else {
      throw e;
    }
  }
}

export const createS3Storage: StorageFactory = async ({ config }) => {
  const top = (config as Record<string, unknown> | null) ?? {};
  const nested = (top["config"] as Record<string, unknown> | null) ?? null;
  const cfg = { ...(nested ?? {}), ...(top ?? {}) } as unknown as S3Deps;
  const { client, mod } = await makeClient(cfg);
  const bucketEnsured = new Set<string>();

  const driver: StorageDriver = {
    async put({ bucket, key, body, contentType, metadata }) {
      if (cfg.ensureBucket && !bucketEnsured.has(bucket)) {
        await ensureBucket(client, mod, bucket).catch(() => void 0);
        bucketEnsured.add(bucket);
      }
      const PutObjectCommand = mod.PutObjectCommand as Ctor<unknown> | undefined;
      if (!PutObjectCommand) throw new Error("S3 PutObjectCommand not available");
      const res = (await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: body,
          ContentType: contentType,
          Metadata: metadata,
        }),
      )) as Record<string, unknown>;
      const etag = (res.ETag as string | undefined)?.replace(/^"|"$/g, "");
      return { etag };
    },
    async getStream({ bucket, key, range }) {
      const GetObjectCommand = mod.GetObjectCommand as Ctor<unknown> | undefined;
      if (!GetObjectCommand) throw new Error("S3 GetObjectCommand not available");
      const res = (await client.send(
        new GetObjectCommand({
          Bucket: bucket,
          Key: key,
          Range: range ? `bytes=${range[0]}-${range[1]}` : undefined,
        }),
      )) as Record<string, unknown>;
      const body = res.Body as unknown;
      if (!body) throw Object.assign(new Error("NotFound"), { status: 404 });
      return body as NodeJS.ReadableStream;
    },
    async head({ bucket, key }) {
      const HeadObjectCommand = mod.HeadObjectCommand as Ctor<unknown> | undefined;
      if (!HeadObjectCommand) throw new Error("S3 HeadObjectCommand not available");
      const res = (await client.send(
        new HeadObjectCommand({ Bucket: bucket, Key: key }),
      )) as Record<string, unknown>;
      const size = Number(res.ContentLength ?? 0);
      const etag = (res.ETag as string | undefined)?.replace(/^"|"$/g, "");
      const checksumSha256Hex = b64ToHex(res.ChecksumSHA256 as string | undefined);
      const contentType = res.ContentType as string | undefined;
      const metadata = (res.Metadata as Record<string, string> | undefined) ?? undefined;
      return { size, contentType, metadata, etag, checksumSha256Hex };
    },
    async del({ bucket, key }) {
      const DeleteObjectCommand = mod.DeleteObjectCommand as Ctor<unknown> | undefined;
      if (!DeleteObjectCommand) throw new Error("S3 DeleteObjectCommand not available");
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    },
    async createSignedGetUrl({ bucket, key, expiresSeconds }) {
      const GetObjectCommand = mod.GetObjectCommand as Ctor<unknown> | undefined;
      const presigner = await importPresignModule();
      if (!GetObjectCommand || !presigner?.getSignedUrl)
        throw new Error("S3 presign get not available");
      return presigner.getSignedUrl(client, new GetObjectCommand({ Bucket: bucket, Key: key }), {
        expiresIn: expiresSeconds,
      });
    },
    async createSignedPutUrl({ bucket, key, contentType, expiresSeconds, headers }) {
      const PutObjectCommand = mod.PutObjectCommand as Ctor<unknown> | undefined;
      const presigner = await importPresignModule();
      if (!PutObjectCommand || !presigner?.getSignedUrl)
        throw new Error("S3 presign put not available");
      const command = new PutObjectCommand({ Bucket: bucket, Key: key, ContentType: contentType });
      const url = await presigner.getSignedUrl(client, command, {
        expiresIn: expiresSeconds ?? 900,
      });
      return { url, headers };
    },
    async copyObject({ bucket, srcKey, destKey, metadata, contentType }) {
      const CopyObjectCommand = mod.CopyObjectCommand as Ctor<unknown> | undefined;
      if (!CopyObjectCommand) throw new Error("S3 CopyObjectCommand not available");
      const params: Record<string, unknown> = {
        Bucket: bucket,
        Key: destKey,
        CopySource: encodeURIComponent(`${bucket}/${srcKey}`),
      };
      if (metadata || contentType) {
        params.MetadataDirective = "REPLACE";
        if (metadata) params.Metadata = metadata as Record<string, string>;
        if (contentType) params.ContentType = contentType;
      }
      const res = (await client.send(new CopyObjectCommand(params))) as Record<string, unknown>;
      const copyRes = (res.CopyObjectResult ?? {}) as Record<string, unknown>;
      const etag = (copyRes.ETag as string | undefined)?.replace(/^"|"$/g, "");
      return { etag };
    },
  };

  return driver;
};

export default createS3Storage;
