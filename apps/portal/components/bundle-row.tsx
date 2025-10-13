/**
 * Individual bundle row inside the bundles table.
 * Handles download availability state and responsive layout fidelity.
 */
"use client";

import { useCooldown } from "@/hooks/use-cooldown";
import { formatBytes, formatCooldown } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Checkbox } from "@/components/ui/checkbox";
import type { Assignment } from "@/hooks/use-assignments";

interface BundleRowProps {
  assignment: Assignment;
  selected: boolean;
  onToggle: () => void;
  disabled: boolean;
}

export function BundleRow({ assignment, selected, onToggle, disabled }: BundleRowProps) {
  const cooldownSeconds = useCooldown(assignment.cooldownRemainingSeconds);
  const isCoolingDown = cooldownSeconds > 0;
  const hasDownloadsRemaining =
    assignment.downloadsRemaining === null ||
    assignment.downloadsRemaining === undefined ||
    assignment.downloadsRemaining > 0;
  const isDownloadable = !isCoolingDown && hasDownloadsRemaining;

  const bundleDetails = assignment.bundle;
  const description =
    (bundleDetails && "description" in bundleDetails ? bundleDetails.description : undefined) ?? "";
  const sizeLabel =
    bundleDetails &&
    "sizeBytes" in bundleDetails &&
    typeof bundleDetails.sizeBytes === "number" &&
    bundleDetails.sizeBytes > 0
      ? formatBytes(bundleDetails.sizeBytes)
      : null;

  const cooldownLabel = isCoolingDown ? formatCooldown(cooldownSeconds) : "Ready";
  const downloadsLabel =
    assignment.downloadsRemaining === null || assignment.downloadsRemaining === undefined
      ? "∞"
      : assignment.downloadsRemaining.toString();

  return (
    <div
      className={cn(
        "grid grid-cols-[auto_minmax(0,1fr)] items-start gap-4 px-8 py-5 text-sm transition-colors sm:grid-cols-[40px,minmax(0,1fr),140px,150px]",
        selected ? "bg-white/65" : "bg-white/35",
        !isDownloadable ? "opacity-65" : "opacity-100",
      )}
      data-testid={`bundle-row-${assignment.bundleId}`}
    >
      <div className="flex items-start gap-4">
        <Checkbox
          checked={selected}
          onCheckedChange={onToggle}
          disabled={disabled || !isDownloadable}
          data-testid="bundle-checkbox"
          aria-label={`Select ${assignment.name}`}
          className="mt-[3px] border border-[#8f9094] bg-white/80 shadow-inner"
        />
        <div className="min-w-0 space-y-2">
          <div className="space-y-1">
            <p className="truncate text-base font-semibold text-[#1f2226]">{assignment.name}</p>
            {description && (
              <p className="line-clamp-2 text-sm text-[#5f6064] sm:line-clamp-1">{description}</p>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs uppercase tracking-wide text-zinc-500">
            {sizeLabel && <span>{sizeLabel}</span>}
            {!isDownloadable && (
              <span className="rounded-full bg-zinc-900/10 px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-zinc-700">
                {isCoolingDown ? "Cooling down" : "Unavailable"}
              </span>
            )}
          </div>
          <div className="flex flex-wrap gap-3 text-xs text-zinc-600 sm:hidden">
            <span className="flex items-center gap-1 font-medium text-zinc-700">
              Cooldown:
              <span className="font-normal">{cooldownLabel}</span>
            </span>
            <span className="flex items-center gap-1 font-medium text-zinc-700">
              Remaining:
              <span className="font-normal">{downloadsLabel}</span>
            </span>
          </div>
        </div>
      </div>

      <div className="hidden items-center justify-center text-sm font-medium text-[#37393d] sm:flex">
        {cooldownLabel}
      </div>
      <div className="hidden items-center justify-center text-sm font-medium text-[#37393d] sm:flex">
        {downloadsLabel}
      </div>
    </div>
  );
}
