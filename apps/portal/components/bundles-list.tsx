/**
 * Bundles list experience for the recipient portal.
 * Handles search, selection, and download queue orchestration.
 */
"use client";

import { useMemo, useState } from "react";
import { Search, X } from "lucide-react";
import { useAssignments } from "@/hooks/use-assignments";
import { useDownloadQueue } from "@/hooks/use-download-queue";
import { BundleRow } from "./bundle-row";
import { DownloadBar } from "./download-bar";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";

export function BundlesList() {
  const { data: assignments, isLoading, error } = useAssignments();
  const queue = useDownloadQueue(assignments ?? []);
  const [searchValue, setSearchValue] = useState("");

  const normalizedQuery = searchValue.trim().toLowerCase();

  const filteredAssignments = useMemo(() => {
    if (!assignments) {
      return [];
    }

    if (!normalizedQuery) {
      return assignments;
    }

    return assignments.filter((assignment) => {
      const haystacks = [assignment.name, assignment.bundle?.description ?? ""]
        .filter(Boolean)
        .map((value) => value.toLowerCase());

      return haystacks.some((value) => value.includes(normalizedQuery));
    });
  }, [assignments, normalizedQuery]);

  const canDownload = (assignment: (typeof filteredAssignments)[number]) =>
    assignment.cooldownRemainingSeconds <= 0 &&
    (assignment.downloadsRemaining === null ||
      assignment.downloadsRemaining === undefined ||
      assignment.downloadsRemaining > 0);

  const downloadableVisible = filteredAssignments.filter(canDownload);
  const selectableVisibleCount = filteredAssignments.filter((assignment) =>
    queue.selectedIds.has(assignment.bundleId),
  ).length;

  const allVisibleSelected =
    downloadableVisible.length > 0 &&
    downloadableVisible.every((assignment) => queue.selectedIds.has(assignment.bundleId));

  const headerCheckboxState =
    allVisibleSelected && downloadableVisible.length > 0
      ? true
      : selectableVisibleCount > 0
        ? "indeterminate"
        : false;

  const hasAssignments = (assignments?.length ?? 0) > 0;
  const hasFilteredResults = filteredAssignments.length > 0;

  const showDownloadButton = queue.selectedIds.size > 0;

  return (
    <div className="flex w-full flex-col items-center gap-10">
      <div className="w-full max-w-[360px]">
        <label htmlFor="bundle-search" className="sr-only">
          Search bundles
        </label>
        <div className="flex items-center gap-2 rounded-full border border-white/10 bg-[#d4d4d6]/80 px-5 py-3 text-[#1f2226] shadow-[0_25px_70px_-50px_rgba(0,0,0,0.85)] backdrop-blur">
          <Search className="size-5 text-[#5b5c5f]" aria-hidden="true" />
          <input
            id="bundle-search"
            value={searchValue}
            onChange={(event) => setSearchValue(event.target.value)}
            placeholder="Search bundles"
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-[#797a7e]"
          />
          {searchValue && (
            <button
              type="button"
              onClick={() => setSearchValue("")}
              className="text-[#797a7e] transition hover:text-[#4a4c52]"
              aria-label="Clear search"
            >
              <X className="size-4" aria-hidden="true" />
            </button>
          )}
        </div>
      </div>

      {queue.queueState !== "idle" && (
        <DownloadBar
          current={queue.currentIndex}
          total={queue.selectedBundles.length}
          state={queue.queueState}
          onCancel={queue.cancel}
          onReset={queue.reset}
        />
      )}

      <div className="w-full max-w-[760px] overflow-hidden rounded-[32px] border border-white/12 bg-[#d5d5d7]/95 text-[#1f2226] shadow-[0_45px_120px_-80px_rgba(0,0,0,0.9)] backdrop-blur">
        <div className="flex flex-col gap-3 border-b border-white/20 bg-[#c8c8ca]/95 px-8 py-6 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-left">
            <h2 className="text-lg font-semibold tracking-tight sm:text-xl">Your Bundles</h2>
            <p className="text-sm text-[#5f6064]">
              {hasAssignments
                ? "Select the bundles you need and download them securely."
                : "Bundles you have access to will appear here."}
            </p>
          </div>
          {showDownloadButton && (
            <Button
              onClick={queue.start}
              disabled={queue.queueState === "running"}
              className="h-11 rounded-2xl bg-[#58595b] px-6 text-sm font-semibold tracking-wide text-white transition hover:bg-[#434446]"
            >
              {queue.queueState === "running"
                ? "Downloading…"
                : `Download selected (${queue.selectedIds.size})`}
            </Button>
          )}
        </div>

        {isLoading && (
          <div className="space-y-3 px-8 py-10">
            {[...Array(4)].map((_, index) => (
              <div
                key={`skeleton-${index}`}
                className="h-16 animate-pulse rounded-2xl bg-white/40"
              />
            ))}
          </div>
        )}

        {!isLoading && error && (
          <div className="px-8 py-12 text-center">
            <p className="text-base font-medium text-red-600">Failed to load bundles</p>
            <p className="mt-2 text-sm text-[#5f6064]">
              {error instanceof Error ? error.message : "Unknown error"}
            </p>
          </div>
        )}

        {!isLoading && !error && (
          <>
            {hasFilteredResults ? (
              <>
                <div className="flex items-center justify-between gap-4 border-b border-white/20 px-8 py-4 text-[11px] font-semibold uppercase tracking-[0.2em] text-[#6e7074]">
                  <div className="flex items-center gap-3">
                    <Checkbox
                      checked={headerCheckboxState}
                      onCheckedChange={() => queue.toggleAll(filteredAssignments)}
                      disabled={downloadableVisible.length === 0 || queue.queueState === "running"}
                      data-testid="bundle-checkbox-header"
                      aria-label="Select all bundles"
                      className="border border-[#8f9094] bg-white/70 shadow-inner"
                    />
                    <span>Select all</span>
                  </div>
                  <div className="hidden min-w-[120px] text-center sm:block">Cooldown</div>
                  <div className="hidden min-w-[150px] text-center sm:block">
                    Remaining Downloads
                  </div>
                </div>

                <div className="divide-y divide-white/25">
                  {filteredAssignments.map((assignment) => (
                    <BundleRow
                      key={assignment.bundleId}
                      assignment={assignment}
                      selected={queue.selectedIds.has(assignment.bundleId)}
                      onToggle={() => queue.toggle(assignment.bundleId)}
                      disabled={queue.queueState === "running"}
                    />
                  ))}
                </div>
              </>
            ) : (
              <div className="px-8 py-16 text-center text-sm text-[#5f6064]">
                {hasAssignments
                  ? "No bundles match your search."
                  : "No bundles available yet. Check back soon."}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
