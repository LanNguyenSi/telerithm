"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { LiveTail } from "@/components/logs/live-tail";
import { LogTable } from "@/components/logs/log-table";
import { SearchPanel } from "@/components/logs/search-panel";
import { Card } from "@/components/ui/card";
import { SkeletonTable } from "@/components/ui/skeleton";
import { getLogs, getNaturalExplanation, streamLogs } from "@/lib/api/client";
import type { LogEntry, Team } from "@/types";

const DEFAULT_PAGE_SIZE = 50;
const ALLOWED_PAGE_SIZES = [25, 50, 100];

export function LogExplorer({ team }: { team: Team }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [sqlPreview, setSqlPreview] = useState("");
  const [execution, setExecution] = useState("");
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);

  const currentQuery = searchParams.get("q")?.trim() ?? "";
  const currentPage = Math.max(1, Number.parseInt(searchParams.get("page") ?? "1", 10) || 1);
  const rawPageSize =
    Number.parseInt(searchParams.get("pageSize") ?? `${DEFAULT_PAGE_SIZE}`, 10) || DEFAULT_PAGE_SIZE;
  const pageSize = ALLOWED_PAGE_SIZES.includes(rawPageSize) ? rawPageSize : DEFAULT_PAGE_SIZE;
  const hasSearched = currentQuery.length > 0;

  // Real-time: prepend new logs to the table via SSE
  useEffect(() => {
    const source = streamLogs(team.id);
    source.addEventListener("log:new", (event: MessageEvent) => {
      const log = JSON.parse(event.data) as LogEntry;
      setLogs((current) => [log, ...current].slice(0, 200));
    });
    return () => source.close();
  }, [team.id]);

  useEffect(() => {
    let active = true;

    async function loadResults() {
      if (!hasSearched) {
        setLogs([]);
        setSqlPreview("");
        setExecution("");
        setTotal(0);
        setLoading(false);
        return;
      }

      setLoading(true);
      setSqlPreview("");
      setExecution("");

      try {
        const offset = (currentPage - 1) * pageSize;
        const [explanation, result] = await Promise.all([
          getNaturalExplanation(team.id, currentQuery).catch(() => null),
          getLogs(team.id, { query: currentQuery, limit: pageSize, offset }),
        ]);

        if (!active) return;

        setLogs(result.logs);
        setTotal(result.total);
        setExecution(`${result.total} logs in ${result.executionTimeMs}ms`);
        if (explanation?.sql) setSqlPreview(explanation.sql);
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    void loadResults();

    return () => {
      active = false;
    };
  }, [currentPage, currentQuery, hasSearched, pageSize, team.id]);

  function updateSearch(next: { query?: string; page?: number; pageSize?: number }) {
    const params = new URLSearchParams(searchParams.toString());
    const query = next.query ?? currentQuery;
    const page = next.page ?? currentPage;
    const nextPageSize = next.pageSize ?? pageSize;

    if (query) {
      params.set("q", query);
      params.set("page", String(page));
      params.set("pageSize", String(nextPageSize));
    } else {
      params.delete("q");
      params.delete("page");
      params.delete("pageSize");
    }

    const queryString = params.toString();
    router.push(queryString ? `${pathname}?${queryString}` : pathname, { scroll: false });
  }

  async function handleSearch(query: string, nextPageSize: number) {
    updateSearch({ query: query.trim(), page: 1, pageSize: nextPageSize });
  }

  return (
    <div className="space-y-4 lg:space-y-6">
      <SearchPanel
        onSearch={handleSearch}
        sqlPreview={sqlPreview}
        currentQuery={currentQuery}
        pageSize={pageSize}
      />

      {hasSearched && (
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

      {loading && hasSearched && <SkeletonTable rows={Math.min(pageSize, 8)} />}

      {hasSearched && logs.length === 0 ? (
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
      ) : !loading && hasSearched ? (
        <LogTable
          logs={logs}
          page={currentPage}
          pageSize={pageSize}
          total={total}
          onPageChange={(page) => updateSearch({ page })}
          onPageSizeChange={(nextPageSize) => updateSearch({ page: 1, pageSize: nextPageSize })}
        />
      ) : !hasSearched ? (
        <Card>
          <div className="py-10 text-center">
            <p className="text-base font-medium text-ink">Search your logs in plain language</p>
            <p className="mt-2 text-sm text-muted">
              Ask for errors, services, or time ranges and page through the results once they load.
            </p>
          </div>
        </Card>
      ) : null}

      <LiveTail teamId={team.id} />
    </div>
  );
}
