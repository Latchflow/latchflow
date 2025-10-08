"use client";

import { Button } from "@/components/ui/button";

interface DownloadBarProps {
  current: number;
  total: number;
  state: "idle" | "running" | "canceled" | "done";
  onCancel: () => void;
  onReset: () => void;
}

export function DownloadBar({ current, total, state, onCancel, onReset }: DownloadBarProps) {
  const progress = total > 0 ? (current / total) * 100 : 0;

  return (
    <div className="bg-white rounded-lg border p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <p className="text-sm font-medium">
            {state === "running" && `Downloading ${current + 1} of ${total}`}
            {state === "done" && `Completed ${current} of ${total}`}
            {state === "canceled" && `Canceled after ${current} of ${total}`}
          </p>
          <p className="text-xs text-gray-600">{Math.round(progress)}% complete</p>
        </div>

        {state === "running" && (
          <Button variant="outline" size="sm" onClick={onCancel}>
            Cancel
          </Button>
        )}

        {(state === "done" || state === "canceled") && (
          <Button variant="outline" size="sm" onClick={onReset}>
            Done
          </Button>
        )}
      </div>

      {/* Progress bar */}
      <div className="w-full bg-gray-200 rounded-full h-2 overflow-hidden">
        <div
          className={`h-full transition-all duration-300 ${
            state === "done"
              ? "bg-green-600"
              : state === "canceled"
                ? "bg-orange-600"
                : "bg-blue-600"
          }`}
          style={{ width: `${progress}%` }}
        />
      </div>
    </div>
  );
}
