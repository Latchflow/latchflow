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
    <div className="mx-auto w-full max-w-[560px] space-y-3 rounded-[24px] border border-white/12 bg-[#cfcfd0]/90 px-6 py-5 text-[#1f2226] shadow-[0_40px_100px_-70px_rgba(0,0,0,0.9)] backdrop-blur">
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <p className="text-sm font-semibold tracking-tight">
            {state === "running" && `Downloading ${current + 1} of ${total}`}
            {state === "done" && `Completed ${current} of ${total}`}
            {state === "canceled" && `Canceled after ${current} of ${total}`}
          </p>
          <p className="text-xs text-zinc-600">{Math.round(progress)}% complete</p>
        </div>

        {state === "running" && (
          <Button
            variant="outline"
            size="sm"
            onClick={onCancel}
            className="rounded-xl border border-zinc-500 bg-white/40 text-zinc-800 hover:bg-white/70"
          >
            Cancel
          </Button>
        )}

        {(state === "done" || state === "canceled") && (
          <Button
            variant="outline"
            size="sm"
            onClick={onReset}
            className="rounded-xl border border-zinc-500 bg-white/40 text-zinc-800 hover:bg-white/70"
          >
            Done
          </Button>
        )}
      </div>

      <div className="h-2 w-full overflow-hidden rounded-full bg-zinc-300">
        <div
          className={`h-full transition-all duration-300 ${
            state === "done"
              ? "bg-emerald-500"
              : state === "canceled"
                ? "bg-amber-500"
                : "bg-zinc-700"
          }`}
          style={{ width: `${progress}%` }}
        />
      </div>
    </div>
  );
}
