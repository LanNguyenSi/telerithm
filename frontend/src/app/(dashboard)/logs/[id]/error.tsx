"use client";

import { Card } from "@/components/ui/card";

export default function LogDetailError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <Card>
      <div className="flex flex-col items-center gap-4 py-12 text-center">
        <h2 className="text-lg font-semibold text-ink">Failed to load log detail</h2>
        <p className="max-w-md text-sm text-muted">
          {error.message || "Could not load the log entry."}
        </p>
        <button
          type="button"
          onClick={reset}
          className="rounded-lg bg-slate-950 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-800"
        >
          Retry
        </button>
      </div>
    </Card>
  );
}
