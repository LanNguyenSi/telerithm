"use client";

import { Card } from "@/components/ui/card";
import type { LogHistogramBucket } from "@/types";

export function HistogramStrip({
  buckets,
  loading,
  onSelectBucket,
}: {
  buckets: LogHistogramBucket[];
  loading: boolean;
  onSelectBucket: (bucket: LogHistogramBucket) => void;
}) {
  const max = buckets.reduce((current, bucket) => Math.max(current, bucket.count), 0);

  return (
    <Card className="p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="text-xs uppercase tracking-[0.16em] text-muted">Volume Over Time</p>
        <p className="text-[11px] text-muted">Click a bucket to narrow range</p>
      </div>
      {loading ? (
        <p className="text-xs text-muted">Loading histogram...</p>
      ) : buckets.length === 0 ? (
        <p className="text-xs text-muted">No histogram data for current scope.</p>
      ) : (
        <div className="grid h-20 grid-flow-col items-end gap-1">
          {buckets.map((bucket) => {
            const ratio = max > 0 ? bucket.count / max : 0;
            const height = Math.max(6, Math.round(ratio * 100));
            return (
              <button
                key={bucket.start}
                type="button"
                onClick={() => onSelectBucket(bucket)}
                title={`${new Date(bucket.start).toLocaleString("de-DE")} - ${bucket.count}`}
                className="group flex h-full items-end"
              >
                <span
                  className="w-3 rounded-sm bg-line transition group-hover:bg-signal dark:bg-white/10"
                  style={{ height: `${height}%` }}
                />
              </button>
            );
          })}
        </div>
      )}
    </Card>
  );
}
