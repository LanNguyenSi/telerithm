"use client";

import { useEffect, useState } from "react";
import { LiveTail } from "@/components/logs/live-tail";
import { LogTable } from "@/components/logs/log-table";
import { SearchPanel } from "@/components/logs/search-panel";
import { Card } from "@/components/ui/card";
import { Skeleton, SkeletonTable } from "@/components/ui/skeleton";
import { getLogs, getNaturalExplanation, streamLogs } from "@/lib/api/client";
import type { LogEntry, Team } from "@/types";

export function LogExplorer({ team }: { team: Team }) {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [sqlPreview, setSqlPreview] = useState("");
  const [execution, setExecution] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(false);
  }, [team.id]);

  // Real-time: prepend new logs to the table via SSE
  useEffect(() => {
    const source = streamLogs(team.id);
    source.addEventListener("log:new", (event: MessageEvent) => {
      const log = JSON.parse(event.data) as LogEntry;
      setLogs((current) => [log, ...current].slice(0, 200));
    });
    return () => source.close();
  }, [team.id]);

  async function handleSearch(query: string) {
    setSqlPreview("");
    setLogs([]); // Clear immediately so user sees loading state
    const result = await getLogs(team.id, query);
    setLogs(result.logs);
    setExecution(`${result.total} logs in ${result.executionTimeMs}ms`);

    // Fetch SQL explanation in background (LLM may be slow)
    getNaturalExplanation(team.id, query)
      .then((translation) => setSqlPreview(translation.sql))
      .catch(() => {});
  }

  return (
    <div className="space-y-4 lg:space-y-6">
      <SearchPanel onSearch={handleSearch} sqlPreview={sqlPreview} />

      {loading ? (
        <section className="rounded-[28px] border border-line bg-panel/85 p-6 shadow-panel backdrop-blur">
          <div className="flex items-center justify-between">
            <div className="space-y-2">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-6 w-40" />
            </div>
            <Skeleton className="h-4 w-32" />
          </div>
        </section>
      ) : (
        <Card className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm uppercase tracking-[0.24em] text-muted">Execution</p>
            <p className="mt-2 text-lg font-semibold text-ink">{execution}</p>
          </div>
          <p className="text-sm text-muted">
            Team <span className="font-mono">{team.slug}</span>
          </p>
        </Card>
      )}

      {loading ? (
        <SkeletonTable rows={8} />
      ) : logs.length === 0 ? (
        <Card>
          <div className="flex flex-col items-center gap-3 py-16 text-center">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="40"
              height="40"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="text-muted"
            >
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
              <line x1="11" y1="8" x2="11" y2="14" />
              <line x1="8" y1="11" x2="14" y2="11" />
            </svg>
            <p className="text-base font-medium text-ink">No logs found</p>
            <p className="max-w-sm text-sm text-muted">
              Try a different query or broaden your time range. Logs are ingested via the API at{" "}
              <span className="font-mono">POST /api/logs/ingest</span>.
            </p>
          </div>
        </Card>
      ) : (
        <LogTable logs={logs} />
      )}

      <LiveTail teamId={team.id} />
    </div>
  );
}
