import { useState, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { apiClient, ApiError } from "@/lib/api-client";
import { toast } from "sonner";
import type { Assignment } from "./use-assignments";

// BundleItem uses the same shape as Assignment
export type BundleItem = Assignment;

export interface DownloadResult {
  bundleId: string;
  status: "success" | "failed" | "skipped";
  message?: string;
}

type QueueState = "idle" | "running" | "canceled" | "done";

export function useDownloadQueue(bundles: BundleItem[]) {
  const queryClient = useQueryClient();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [queueState, setQueueState] = useState<QueueState>("idle");
  const [currentIndex, setCurrentIndex] = useState(0);
  const [results, setResults] = useState<DownloadResult[]>([]);
  const [shouldCancel, setShouldCancel] = useState(false);

  const toggle = useCallback((bundleId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(bundleId)) {
        next.delete(bundleId);
      } else {
        next.add(bundleId);
      }
      return next;
    });
  }, []);

  const toggleAll = useCallback(() => {
    // Find all downloadable bundles (not cooling down, has downloads remaining)
    const downloadable = bundles.filter(
      (b) =>
        b.cooldownRemainingSeconds <= 0 &&
        (b.downloadsRemaining === null ||
          b.downloadsRemaining === undefined ||
          b.downloadsRemaining > 0),
    );

    setSelectedIds((prev) => {
      // If all downloadable are selected, deselect all
      if (downloadable.every((b) => prev.has(b.bundleId))) {
        return new Set();
      }
      // Otherwise, select all downloadable
      return new Set(downloadable.map((b) => b.bundleId));
    });
  }, [bundles]);

  const downloadBundle = async (bundle: BundleItem): Promise<DownloadResult> => {
    // Check if bundle is available
    if (bundle.cooldownRemainingSeconds > 0) {
      return {
        bundleId: bundle.bundleId,
        status: "skipped",
        message: `Cooling down (${bundle.cooldownRemainingSeconds}s remaining)`,
      };
    }

    if (
      bundle.downloadsRemaining !== null &&
      bundle.downloadsRemaining !== undefined &&
      bundle.downloadsRemaining <= 0
    ) {
      return {
        bundleId: bundle.bundleId,
        status: "skipped",
        message: "No downloads remaining",
      };
    }

    try {
      const blob = await apiClient.download(`/portal/bundles/${bundle.bundleId}`);

      // Warn about large files
      if (blob.size > 500 * 1024 * 1024) {
        toast.warning(`${bundle.name} is large (${(blob.size / (1024 * 1024)).toFixed(1)} MB)`);
      }

      // Create object URL and trigger download
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${bundle.name}.zip`;
      a.style.display = "none";
      document.body.appendChild(a);
      a.click();

      // Cleanup
      setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }, 100);

      return {
        bundleId: bundle.bundleId,
        status: "success",
      };
    } catch (error) {
      let message = "Download failed";
      if (error instanceof ApiError) {
        if (error.status === 409) {
          message = "Cooldown active or limit reached";
        } else if (error.status === 429) {
          message = "Rate limit exceeded";
        } else {
          message = error.message;
        }
      }

      return {
        bundleId: bundle.bundleId,
        status: "failed",
        message,
      };
    }
  };

  const start = useCallback(async () => {
    const selected = bundles.filter((b) => selectedIds.has(b.bundleId));
    if (selected.length === 0) {
      toast.error("No bundles selected");
      return;
    }

    setQueueState("running");
    setCurrentIndex(0);
    setResults([]);
    setShouldCancel(false);

    for (let i = 0; i < selected.length; i++) {
      if (shouldCancel) {
        setQueueState("canceled");
        return;
      }

      setCurrentIndex(i);
      const bundle = selected[i];
      const result = await downloadBundle(bundle);

      setResults((prev) => [...prev, result]);

      // Show toast for each result
      if (result.status === "success") {
        toast.success(`Downloaded: ${bundle.name}`);
      } else if (result.status === "failed") {
        toast.error(`Failed: ${bundle.name} - ${result.message}`);
      } else {
        toast.info(`Skipped: ${bundle.name} - ${result.message}`);
      }

      // Small delay between downloads
      if (i < selected.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }

    setQueueState("done");
    setCurrentIndex(selected.length);

    // Refetch assignments after all downloads complete
    await queryClient.invalidateQueries({ queryKey: ["assignments"] });
  }, [bundles, selectedIds, shouldCancel, queryClient]);

  const cancel = useCallback(() => {
    setShouldCancel(true);
    setQueueState("canceled");
  }, []);

  const reset = useCallback(() => {
    setQueueState("idle");
    setCurrentIndex(0);
    setResults([]);
    setShouldCancel(false);
    setSelectedIds(new Set());
  }, []);

  const selectedBundles = bundles.filter((b) => selectedIds.has(b.bundleId));

  return {
    selectedIds,
    queueState,
    currentIndex,
    results,
    selectedBundles,
    toggle,
    toggleAll,
    start,
    cancel,
    reset,
  };
}
