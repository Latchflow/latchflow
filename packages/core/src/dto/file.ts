export type FileRecordLike = {
  id: string;
  key: string;
  size: bigint | number;
  contentType: string;
  metadata?: Record<string, string> | null;
  contentHash?: string | null;
  updatedAt: Date | string;
};

export type FileDto = {
  id: string;
  key: string;
  size: number;
  contentType: string;
  metadata?: Record<string, string>;
  etag?: string;
  updatedAt: string;
};

function toIsoString(v: Date | string): string {
  return typeof v === "string" ? v : v.toISOString();
}

function toNumber(n: bigint | number): number {
  return typeof n === "bigint" ? Number(n) : n;
}

export function toFileDto(rec: FileRecordLike): FileDto {
  const out: FileDto = {
    id: rec.id,
    key: rec.key,
    size: toNumber(rec.size),
    contentType: rec.contentType,
    updatedAt: toIsoString(rec.updatedAt),
  };
  if (rec.metadata && typeof rec.metadata === "object") {
    out.metadata = rec.metadata as Record<string, string>;
  }
  if (rec.contentHash) {
    out.etag = rec.contentHash;
  }
  return out;
}
