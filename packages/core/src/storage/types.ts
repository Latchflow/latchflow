export interface StorageDriver {
  put(opts: {
    bucket: string;
    key: string;
    body: Buffer | NodeJS.ReadableStream;
    contentType?: string;
    metadata?: Record<string, string>;
  }): Promise<{ etag?: string; size?: number }>;
  getStream(opts: {
    bucket: string;
    key: string;
    range?: [number, number];
  }): Promise<NodeJS.ReadableStream>;
  head(opts: { bucket: string; key: string }): Promise<{
    size: number;
    contentType?: string;
    metadata?: Record<string, string>;
    etag?: string;
    checksumSha256Hex?: string;
  }>;
  del(opts: { bucket: string; key: string }): Promise<void>;
  // Optional capabilities
  createSignedGetUrl?(opts: {
    bucket: string;
    key: string;
    expiresSeconds: number;
  }): Promise<string>;
  createSignedPutUrl?(opts: {
    bucket: string;
    key: string;
    contentType?: string;
    expiresSeconds?: number;
    headers?: Record<string, string>;
  }): Promise<{ url: string; headers?: Record<string, string>; expiresAt?: string }>;
  createSignedPostForm?(opts: {
    bucket: string;
    key: string;
    contentType?: string;
    expiresSeconds?: number;
    conditions?: unknown;
  }): Promise<{ url: string; fields: Record<string, string>; expiresAt?: string }>;
  copyObject?(opts: {
    bucket: string;
    srcKey: string;
    destKey: string;
    metadata?: Record<string, string>;
    contentType?: string;
  }): Promise<{ etag?: string }>;
}

export type StorageFactory = (opts: { config: unknown }) => Promise<StorageDriver>;
