"use client";

import { Card } from "@/components/ui/card";
import { formatDate } from "@/lib/utils/format";
import type { LogPattern } from "@/types";

export function PatternTable({
  patterns,
  onOpenPattern,
  onConvertToFilter,
}: {
  patterns: LogPattern[];
  onOpenPattern: (pattern: LogPattern) => void;
  onConvertToFilter: (pattern: LogPattern) => void;
}) {
  return (
    <Card className="overflow-hidden p-0">
      <div className="overflow-x-auto">
        <table className="min-w-full text-left text-sm">
          <thead className="border-b border-line bg-slate-950 text-[11px] uppercase tracking-[0.14em] text-white">
            <tr>
              <th className="px-3 py-2.5">Count</th>
              <th className="px-3 py-2.5">Latest</th>
              <th className="px-3 py-2.5">Level</th>
              <th className="px-3 py-2.5">Service</th>
              <th className="px-3 py-2.5">Pattern</th>
              <th className="px-3 py-2.5">Actions</th>
            </tr>
          </thead>
          <tbody>
            {patterns.map((pattern) => (
              <tr key={pattern.key} className="border-b border-line/80 bg-white/70 dark:bg-white/5">
                <td className="px-3 py-2 font-mono text-xs text-ink">{pattern.count}</td>
                <td className="px-3 py-2 font-mono text-xs text-muted">
                  {formatDate(pattern.latestTimestamp)}
                </td>
                <td className="px-3 py-2 font-mono text-xs text-ink">{pattern.level ?? "-"}</td>
                <td className="px-3 py-2 font-mono text-xs text-ink">{pattern.service ?? "-"}</td>
                <td className="max-w-2xl px-3 py-2 text-xs text-ink">
                  <p className="line-clamp-2 whitespace-pre-wrap break-all">{pattern.sampleMessage}</p>
                  <p className="mt-1 font-mono text-[11px] text-muted">signature: {pattern.signature}</p>
                </td>
                <td className="px-3 py-2">
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => onOpenPattern(pattern)}
                      className="rounded border border-line px-2 py-0.5 text-[11px] text-muted transition hover:text-ink"
                    >
                      Open events
                    </button>
                    <button
                      type="button"
                      onClick={() => onConvertToFilter(pattern)}
                      className="rounded border border-line px-2 py-0.5 text-[11px] text-muted transition hover:text-ink"
                    >
                      Add as filter
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
