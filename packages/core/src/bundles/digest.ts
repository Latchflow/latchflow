import { createHash } from "node:crypto";
import type { DbClient } from "../db/db.js";

export type BundleDigestItem = {
  fileId: string;
  contentHash: string;
  path: string | null;
  required: boolean;
  sortOrder: number;
};

function sha256Hex(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

/**
 * Computes a stable digest for a bundle's composition over ordered
 * { fileId, file.contentHash, path, required, sortOrder } items.
 */
export async function computeBundleDigest(
  db: DbClient,
  bundleId: string,
): Promise<{
  digest: string;
  items: BundleDigestItem[];
}> {
  const rec = await db.bundle.findUnique({
    where: { id: bundleId },
    select: {
      id: true,
      bundleObjects: {
        where: { isEnabled: true },
        orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
        select: {
          fileId: true,
          path: true,
          required: true,
          sortOrder: true,
          file: { select: { id: true, contentHash: true } },
        },
      },
    },
  });
  if (!rec) return { digest: "", items: [] };
  const items: BundleDigestItem[] = [];
  for (const bo of rec.bundleObjects) {
    const ch = bo.file?.contentHash ?? "";
    items.push({
      fileId: bo.fileId,
      contentHash: ch,
      path: bo.path ?? null,
      required: Boolean(bo.required),
      sortOrder: Number(bo.sortOrder ?? 0),
    });
  }
  // Deterministic JSON: keys in fixed order
  const serialized = JSON.stringify(
    items.map((i) => ({
      fileId: i.fileId,
      contentHash: i.contentHash,
      path: i.path,
      required: i.required,
      sortOrder: i.sortOrder,
    })),
  );
  return { digest: sha256Hex(serialized), items };
}
