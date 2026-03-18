"use client";

import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { formatDate } from "@/lib/utils/format";
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
          <h2 className="text-xl font-semibold text-ink">Live Tail</h2>
          <p className="text-sm text-muted">Server-sent events stream for newly ingested logs.</p>
        </div>
        <span className={connected ? "text-sm text-emerald-600" : "text-sm text-muted"}>
          {connected ? "Connected" : "Waiting"}
        </span>
      </div>
      <div className="mt-6 space-y-3">
        {items.length === 0 ? (
          <p className="text-sm text-muted">No live events yet. Send logs to the ingest endpoint.</p>
        ) : (
          items.map((log) => (
            <article key={log.id} className="rounded-2xl border border-line bg-white/70 p-4">
              <div className="flex flex-wrap items-center gap-3 text-sm text-muted">
                <span>{formatDate(log.timestamp)}</span>
                <span className="font-mono">{log.service}</span>
                <span>{log.level}</span>
              </div>
              <p className="mt-2 text-sm text-ink">{log.message}</p>
            </article>
          ))
        )}
      </div>
    </Card>
  );
}

