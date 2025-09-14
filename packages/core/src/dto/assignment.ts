// Assignment summary DTO and mapper

export type AssignmentSummary = {
  bundleId: string;
  name: string;
  maxDownloads: number | null;
  downloadsUsed: number;
  downloadsRemaining: number | null;
  cooldownSeconds: number | null;
  lastDownloadAt: string | null;
  nextAvailableAt: string | null;
  cooldownRemainingSeconds: number;
};

export type AssignmentRowForSummary = {
  id: string;
  bundleId: string;
  maxDownloads: number | null;
  cooldownSeconds: number | null;
  lastDownloadAt: Date | null;
  bundle?: { id: string; name: string } | null;
};

export function toAssignmentSummary(
  row: AssignmentRowForSummary,
  downloadsUsed: number,
  now: Date = new Date(),
): AssignmentSummary {
  const name = row.bundle?.name ?? "";
  const bundleId = row.bundle?.id ?? row.bundleId;
  const remaining = row.maxDownloads != null ? Math.max(0, row.maxDownloads - downloadsUsed) : null;
  const nextAvailableAtDate =
    row.cooldownSeconds != null && row.lastDownloadAt
      ? new Date(row.lastDownloadAt.getTime() + row.cooldownSeconds * 1000)
      : null;
  const cooldownRemainingSeconds = nextAvailableAtDate
    ? Math.max(0, Math.ceil((nextAvailableAtDate.getTime() - now.getTime()) / 1000))
    : 0;
  return {
    bundleId,
    name,
    maxDownloads: row.maxDownloads,
    downloadsUsed,
    downloadsRemaining: remaining,
    cooldownSeconds: row.cooldownSeconds,
    lastDownloadAt: row.lastDownloadAt ? row.lastDownloadAt.toISOString() : null,
    nextAvailableAt: nextAvailableAtDate ? nextAvailableAtDate.toISOString() : null,
    cooldownRemainingSeconds,
  };
}
