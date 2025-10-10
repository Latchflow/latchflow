"use client";

import { useCooldown } from "@/hooks/use-cooldown";
import { formatCooldown } from "@/lib/format";
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

  return (
    <div
      className={`bg-white rounded-lg border p-4 flex items-center gap-4 transition-colors ${
        !isDownloadable ? "opacity-60" : ""
      }`}
      data-testid={`bundle-row-${assignment.bundleId}`}
    >
      <Checkbox
        checked={selected}
        onCheckedChange={onToggle}
        disabled={disabled || !isDownloadable}
        data-testid="bundle-checkbox"
      />

      <div className="flex-1 min-w-0">
        <h3 className="font-medium truncate">{assignment.name}</h3>
        <div className="flex items-center gap-4 mt-1 text-sm text-gray-600">
          {isCoolingDown && (
            <span className="text-orange-600 font-medium">
              Cooldown: {formatCooldown(cooldownSeconds)}
            </span>
          )}
          {assignment.downloadsRemaining !== null && (
            <span>
              {assignment.downloadsRemaining} download
              {assignment.downloadsRemaining !== 1 ? "s" : ""} remaining
            </span>
          )}
          {assignment.downloadsRemaining === null && <span>Unlimited downloads</span>}
        </div>
      </div>

      {!isDownloadable && (
        <div className="text-sm text-gray-500">
          {isCoolingDown ? "Cooling down" : "No downloads left"}
        </div>
      )}
    </div>
  );
}
