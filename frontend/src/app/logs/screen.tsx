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
const DEFAULT_SORT = { sortBy: "timestamp" as const, sortDirection: "desc" as const };

export function LogExplorer({ team }: { team: Team }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [sqlPreview, setSqlPreview] = useState("");
  const [execution, setExecution] = useState("");
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const currentQuery = searchParams.get("q")?.trim() ?? "";
  const currentPage = Math.max(1, Number.parseInt(searchParams.get("page") ?? "1", 10) || 1);
  const rawPageSize =
    Number.parseInt(searchParams.get("pageSize") ?? `${DEFAULT_PAGE_SIZE}`, 10) || DEFAULT_PAGE_SIZE;
  const pageSize = ALLOWED_PAGE_SIZES.includes(rawPageSize) ? rawPageSize : DEFAULT_PAGE_SIZE;
  const currentFilters = {
    level: searchParams.get("level") ?? "",
    service: searchParams.get("service") ?? "",
    host: searchParams.get("host") ?? "",
  };
  const currentSort = {
    sortBy:
      (searchParams.get("sortBy") as "timestamp" | "level" | "service" | "host" | null) ??
      DEFAULT_SORT.sortBy,
    sortDirection: (searchParams.get("sortDirection") as "asc" | "desc" | null) ?? DEFAULT_SORT.sortDirection,
  };

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
      setLoading(true);
      setError(null);
      setSqlPreview("");
      setExecution("");

      try {
        const offset = (currentPage - 1) * pageSize;
        const filters = [
          currentFilters.level
            ? { field: "level", operator: "eq" as const, value: currentFilters.level }
            : null,
          currentFilters.service
            ? { field: "service", operator: "contains" as const, value: currentFilters.service }
            : null,
          currentFilters.host
            ? { field: "host", operator: "contains" as const, value: currentFilters.host }
            : null,
        ].filter(
          (item): item is { field: string; operator: "eq" | "contains"; value: string } => item !== null,
        );
        const [explanation, result] = await Promise.all([
          currentQuery
            ? getNaturalExplanation(team.id, currentQuery).catch(() => null)
            : Promise.resolve(null),
          getLogs(team.id, {
            query: currentQuery || undefined,
            filters,
            sortBy: currentSort.sortBy,
            sortDirection: currentSort.sortDirection,
            limit: pageSize,
            offset,
          }),
        ]);

        if (!active) return;

        setLogs(result.logs);
        setTotal(result.total);
        setExecution(`${result.total} logs in ${result.executionTimeMs}ms`);
        if (explanation?.sql) setSqlPreview(explanation.sql);
      } catch (loadError) {
        if (active) {
          setError(loadError instanceof Error ? loadError.message : "Could not load logs");
          setLogs([]);
          setTotal(0);
        }
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
  }, [
    currentFilters.host,
    currentFilters.level,
    currentFilters.service,
    currentPage,
    currentQuery,
    currentSort.sortBy,
    currentSort.sortDirection,
    pageSize,
    reloadToken,
    team.id,
  ]);

  function updateSearch(next: {
    query?: string;
    page?: number;
    pageSize?: number;
    level?: string;
    service?: string;
    host?: string;
    sortBy?: "timestamp" | "level" | "service" | "host";
    sortDirection?: "asc" | "desc";
  }) {
    const params = new URLSearchParams(searchParams.toString());
    const query = next.query ?? currentQuery;
    const page = next.page ?? currentPage;
    const nextPageSize = next.pageSize ?? pageSize;
    const level = next.level ?? currentFilters.level;
    const service = next.service ?? currentFilters.service;
    const host = next.host ?? currentFilters.host;
    const sortBy = next.sortBy ?? currentSort.sortBy;
    const sortDirection = next.sortDirection ?? currentSort.sortDirection;

    if (query) params.set("q", query);
    else params.delete("q");
    if (page > 1) params.set("page", String(page));
    else params.delete("page");
    if (nextPageSize !== DEFAULT_PAGE_SIZE) params.set("pageSize", String(nextPageSize));
    else params.delete("pageSize");
    if (level) params.set("level", level);
    else params.delete("level");
    if (service) params.set("service", service);
    else params.delete("service");
    if (host) params.set("host", host);
    else params.delete("host");
    if (sortBy !== DEFAULT_SORT.sortBy) params.set("sortBy", sortBy);
    else params.delete("sortBy");
    if (sortDirection !== DEFAULT_SORT.sortDirection) params.set("sortDirection", sortDirection);
    else params.delete("sortDirection");

    const queryString = params.toString();
    router.push(queryString ? `${pathname}?${queryString}` : pathname, { scroll: false });
  }

  async function handleSearch(
    query: string,
    filters: { level: string; service: string; host: string },
    sort: { sortBy: "timestamp" | "level" | "service" | "host"; sortDirection: "asc" | "desc" },
    nextPageSize: number,
  ) {
    updateSearch({
      query: query.trim(),
      page: 1,
      pageSize: nextPageSize,
      level: filters.level,
      service: filters.service,
      host: filters.host,
      sortBy: sort.sortBy,
      sortDirection: sort.sortDirection,
    });
  }

  return (
    <div className="space-y-4 lg:space-y-6">
      <SearchPanel
        onSearch={handleSearch}
        sqlPreview={sqlPreview}
        currentQuery={currentQuery}
        currentFilters={currentFilters}
        currentSort={currentSort}
        pageSize={pageSize}
      />

      <Card className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm uppercase tracking-[0.24em] text-muted">Execution</p>
          <p className="mt-2 text-lg font-semibold text-ink">{execution || `${total} logs`}</p>
        </div>
        <p className="text-sm text-muted">
          Team <span className="font-mono">{team.slug}</span>
        </p>
      </Card>

      {loading && <SkeletonTable rows={Math.min(pageSize, 8)} />}

      {error ? (
        <Card>
          <div className="flex flex-col items-center gap-3 py-12 text-center">
            <p className="text-base font-medium text-ink">Failed to load logs</p>
            <p className="max-w-md text-sm text-muted">{error}</p>
            <button
              type="button"
              onClick={() => setReloadToken((value) => value + 1)}
              className="rounded-xl bg-slate-950 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-800"
            >
              Retry
            </button>
          </div>
        </Card>
      ) : !loading && logs.length === 0 ? (
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
              Adjust the natural-language query, filters, or sort order to widen the result set.
            </p>
          </div>
        </Card>
      ) : !loading ? (
        <LogTable
          logs={logs}
          page={currentPage}
          pageSize={pageSize}
          total={total}
          onPageChange={(page) => updateSearch({ page })}
          onPageSizeChange={(nextPageSize) => updateSearch({ page: 1, pageSize: nextPageSize })}
        />
      ) : null}

      <LiveTail teamId={team.id} />
    </div>
  );
}
