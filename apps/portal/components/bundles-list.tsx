"use client";

import { useAssignments } from "@/hooks/use-assignments";
import { useDownloadQueue } from "@/hooks/use-download-queue";
import { BundleRow } from "./bundle-row";
import { DownloadBar } from "./download-bar";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";

export function BundlesList() {
  const { data: assignments, isLoading, error } = useAssignments();

  const queue = useDownloadQueue(assignments || []);

  if (isLoading) {
    return (
      <div className="space-y-4">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="h-20 bg-white rounded-lg border animate-pulse" />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-white rounded-lg border p-8 text-center">
        <p className="text-red-600 font-medium">Failed to load bundles</p>
        <p className="text-sm text-gray-600 mt-2">
          {error instanceof Error ? error.message : "Unknown error"}
        </p>
      </div>
    );
  }

  if (!assignments || assignments.length === 0) {
    return (
      <div className="bg-white rounded-lg border p-12 text-center">
        <p className="text-gray-600">No bundles available yet</p>
      </div>
    );
  }

  const downloadableCount = assignments.filter(
    (a) =>
      a.cooldownRemainingSeconds <= 0 &&
      (a.downloadsRemaining === null ||
        a.downloadsRemaining === undefined ||
        a.downloadsRemaining > 0),
  ).length;

  const allDownloadableSelected =
    downloadableCount > 0 &&
    assignments
      .filter(
        (a) =>
          a.cooldownRemainingSeconds <= 0 &&
          (a.downloadsRemaining === null ||
            a.downloadsRemaining === undefined ||
            a.downloadsRemaining > 0),
      )
      .every((a) => queue.selectedIds.has(a.bundleId));

  return (
    <div className="space-y-4">
      {/* Header with select all */}
      <div className="bg-white rounded-lg border p-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Checkbox
            checked={allDownloadableSelected && downloadableCount > 0}
            onCheckedChange={queue.toggleAll}
            disabled={downloadableCount === 0 || queue.queueState === "running"}
            data-testid="bundle-checkbox-header"
          />
          <span className="text-sm font-medium">
            {queue.selectedIds.size > 0 ? `${queue.selectedIds.size} selected` : "Select all"}
          </span>
        </div>

        {queue.selectedIds.size > 0 && (
          <Button onClick={queue.start} disabled={queue.queueState === "running"}>
            {queue.queueState === "running"
              ? "Downloading..."
              : `Download selected (${queue.selectedIds.size})`}
          </Button>
        )}
      </div>

      {/* Download progress bar */}
      {queue.queueState !== "idle" && (
        <DownloadBar
          current={queue.currentIndex}
          total={queue.selectedBundles.length}
          state={queue.queueState}
          onCancel={queue.cancel}
          onReset={queue.reset}
        />
      )}

      {/* Bundle list */}
      <div className="space-y-2">
        {assignments.map((assignment) => (
          <BundleRow
            key={assignment.bundleId}
            assignment={assignment}
            selected={queue.selectedIds.has(assignment.bundleId)}
            onToggle={() => queue.toggle(assignment.bundleId)}
            disabled={queue.queueState === "running"}
          />
        ))}
      </div>
    </div>
  );
}
