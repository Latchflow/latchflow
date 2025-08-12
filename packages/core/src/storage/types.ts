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
  head(opts: {
    bucket: string;
    key: string;
  }): Promise<{ size: number; contentType?: string; metadata?: Record<string, string> }>;
  del(opts: { bucket: string; key: string }): Promise<void>;
  createSignedGetUrl?(opts: {
    bucket: string;
    key: string;
    expiresSeconds: number;
  }): Promise<string>;
}

export type StorageFactory = (opts: { config: unknown }) => Promise<StorageDriver>;
