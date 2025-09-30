import type { PluginServiceContext } from "./context.js";

export interface ReleaseLinkRequest {
  bundleId: string;
  recipientId: string;
  ttlSeconds?: number;
  reason?: string;
}

export interface ReleaseLinkResult {
  url: string;
  expiresAt?: string;
  contentHash?: string;
}

export interface StorageAccessService {
  createReleaseLink(
    context: PluginServiceContext,
    request: ReleaseLinkRequest,
  ): Promise<ReleaseLinkResult>;
  getBundleObjectHead(
    context: PluginServiceContext,
    bundleId: string,
    objectKey: string,
  ): Promise<{ etag?: string; contentType?: string; contentLength?: number } | null>;
}
