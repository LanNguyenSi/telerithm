"use client";

import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { decodeHtml, formatDate } from "@/lib/utils/format";
import { streamLogs } from "@/lib/api/client";
import type { LogEntry } from "@/types";

export function LiveTail({ teamId }: { teamId: string }) {
  const [items, setItems] = useState<LogEntry[]>([]);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const source = streamLogs(teamId);

    source.addEventListener("open", () => setConnected(true));
    source.addEventListener("error", () => setConnected(false));
    source.addEventListener("log:new", (event) => {
      const log = JSON.parse(event.data) as LogEntry;
      setItems((current) => [log, ...current].slice(0, 8));
    });

    return () => {
      source.close();
    };
  }, [teamId]);

  return (
    <Card>
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-ink">Live Tail</h2>
          <p className="text-xs text-muted">SSE stream for newly ingested logs.</p>
        </div>
        <span className={connected ? "text-sm text-emerald-600 dark:text-emerald-400" : "text-sm text-muted"}>
          {connected ? "Connected" : "Waiting"}
        </span>
      </div>
      <div className="mt-4 space-y-2">
        {items.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-10 text-center">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="36"
              height="36"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="text-muted"
            >
              <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
            </svg>
            <p className="text-sm font-medium text-ink">No live events yet</p>
            <p className="max-w-xs text-sm text-muted">
              Send logs to the ingest endpoint to see them appear here in real time.
            </p>
          </div>
        ) : (
          items.map((log) => (
            <article key={log.id} className="rounded-xl border border-line bg-white/70 p-3 dark:bg-white/5">
              <div className="flex flex-wrap items-center gap-3 font-mono text-xs text-muted">
                <span>{formatDate(log.timestamp)}</span>
                <span>{decodeHtml(log.service)}</span>
                <span>{log.level}</span>
              </div>
              <p className="mt-1.5 break-all text-sm text-ink">{decodeHtml(log.message)}</p>
            </article>
          ))
        )}
      </div>
    </Card>
  );
}
