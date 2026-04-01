"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { FacetSidebar } from "@/components/logs/facet-sidebar";
import { FieldExplorer } from "@/components/logs/field-explorer";
import { HistogramStrip } from "@/components/logs/histogram-strip";
import { LiveTail } from "@/components/logs/live-tail";
import { LogEventDrawer } from "@/components/logs/log-event-drawer";
import { LogTable } from "@/components/logs/log-table";
import { SearchPanel } from "@/components/logs/search-panel";
import { Card } from "@/components/ui/card";
import { SkeletonTable } from "@/components/ui/skeleton";
import {
  getLogContext,
  getLogFacets,
  getLogHistogram,
  getLogs,
  getNaturalExplanation,
} from "@/lib/api/client";
import type { LogEntry, LogFacet, LogHistogramBucket, Team } from "@/types";

const DEFAULT_PAGE_SIZE = 50;
const ALLOWED_PAGE_SIZES = [25, 50, 100];
const DEFAULT_SORT = { sortBy: "timestamp" as const, sortDirection: "desc" as const };
const DEFAULT_LOOKBACK_MS = 60 * 60 * 1000;
const EXCLUDE_PARAM_SEPARATOR = "::";
const FACET_FIELDS: Array<
  "service" | "level" | "host" | "sourceId" | "env" | "region" | "status_code" | "route"
> = ["service", "level", "host", "sourceId", "env", "region", "status_code", "route"];

function defaultTimeRange(): { startTime: string; endTime: string } {
  const end = new Date();
  const start = new Date(end.getTime() - DEFAULT_LOOKBACK_MS);
  return { startTime: start.toISOString(), endTime: end.toISOString() };
}

interface ExclusionChip {
  field: string;
  value: string;
}

interface FacetSelection {
  field: string;
  value: string;
}

function parseExclusions(params: URLSearchParams): ExclusionChip[] {
  return params
    .getAll("exclude")
    .map((token) => {
      const [field, value] = token.split(EXCLUDE_PARAM_SEPARATOR);
      if (!field || !value) return null;
      return {
        field: decodeURIComponent(field),
        value: decodeURIComponent(value),
      };
    })
    .filter((item): item is ExclusionChip => item !== null);
}

function parseFacetSelections(params: URLSearchParams): FacetSelection[] {
  return params
    .getAll("facet")
    .map((token) => {
      const [field, value] = token.split(EXCLUDE_PARAM_SEPARATOR);
      if (!field || !value) return null;
      return {
        field: decodeURIComponent(field),
        value: decodeURIComponent(value),
      };
    })
    .filter((item): item is FacetSelection => item !== null);
}

function parseColumns(params: URLSearchParams): string[] {
  return params
    .getAll("col")
    .map((value) => decodeURIComponent(value))
    .filter((value, index, values) => value.length > 0 && values.indexOf(value) === index);
}

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
  const [selectedLog, setSelectedLog] = useState<LogEntry | null>(null);
  const [contextBefore, setContextBefore] = useState<LogEntry[]>([]);
  const [contextAfter, setContextAfter] = useState<LogEntry[]>([]);
  const [contextLoading, setContextLoading] = useState(false);
  const [contextScope, setContextScope] = useState<"source" | "service" | "host">("source");
  const [facets, setFacets] = useState<LogFacet[]>([]);
  const [facetLoading, setFacetLoading] = useState(false);
  const [histogram, setHistogram] = useState<LogHistogramBucket[]>([]);
  const [histogramLoading, setHistogramLoading] = useState(false);
  const [fallbackRange] = useState(defaultTimeRange);

  const currentQuery = searchParams.get("q")?.trim() ?? "";
  const searchParamString = searchParams.toString();
  const currentPage = Math.max(1, Number.parseInt(searchParams.get("page") ?? "1", 10) || 1);
  const rawPageSize =
    Number.parseInt(searchParams.get("pageSize") ?? `${DEFAULT_PAGE_SIZE}`, 10) || DEFAULT_PAGE_SIZE;
  const pageSize = ALLOWED_PAGE_SIZES.includes(rawPageSize) ? rawPageSize : DEFAULT_PAGE_SIZE;
  const currentFilters = {
    level: searchParams.get("level") ?? "",
    service: searchParams.get("service") ?? "",
    host: searchParams.get("host") ?? "",
  };
  const currentSourceId = searchParams.get("sourceId") ?? "";
  const currentExclusions = useMemo(
    () => parseExclusions(new URLSearchParams(searchParamString)),
    [searchParamString],
  );
  const currentFacetSelections = useMemo(
    () => parseFacetSelections(new URLSearchParams(searchParamString)),
    [searchParamString],
  );
  const currentColumns = useMemo(
    () => parseColumns(new URLSearchParams(searchParamString)),
    [searchParamString],
  );
  const currentTimeRange = {
    startTime: searchParams.get("startTime") ?? fallbackRange.startTime,
    endTime: searchParams.get("endTime") ?? fallbackRange.endTime,
  };
  const currentSort = {
    sortBy:
      (searchParams.get("sortBy") as "timestamp" | "level" | "service" | "host" | null) ??
      DEFAULT_SORT.sortBy,
    sortDirection: (searchParams.get("sortDirection") as "asc" | "desc" | null) ?? DEFAULT_SORT.sortDirection,
  };
  const discoveredFields = useMemo(() => {
    const summary = new Map<string, { hits: number; counts: Map<string, number> }>();

    for (const log of logs) {
      for (const [key, value] of Object.entries(log.fields ?? {})) {
        const entry = summary.get(key) ?? { hits: 0, counts: new Map<string, number>() };
        entry.hits += 1;
        const valueKey = String(value);
        entry.counts.set(valueKey, (entry.counts.get(valueKey) ?? 0) + 1);
        summary.set(key, entry);
      }
    }

    return Array.from(summary.entries())
      .map(([key, value]) => ({
        key,
        hits: value.hits,
        topValues: Array.from(value.counts.entries())
          .sort((left, right) => right[1] - left[1])
          .slice(0, 3)
          .map(([item]) => item),
      }))
      .sort((left, right) => right.hits - left.hits)
      .slice(0, 20);
  }, [logs]);

  useEffect(() => {
    let active = true;

    async function loadResults() {
      setLoading(true);
      setFacetLoading(true);
      setHistogramLoading(true);
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
          ...currentExclusions.map((item) => ({
            field: item.field,
            operator: "neq" as const,
            value: item.value,
          })),
          ...currentFacetSelections.map((item) => ({
            field: item.field,
            operator: "eq" as const,
            value: item.value,
          })),
        ].filter(
          (item): item is { field: string; operator: "eq" | "contains" | "neq"; value: string } =>
            item !== null,
        );
        const [explanation, result, facetResult, histogramResult] = await Promise.all([
          currentQuery
            ? getNaturalExplanation(team.id, currentQuery).catch(() => null)
            : Promise.resolve(null),
          getLogs(team.id, {
            sourceId: currentSourceId || undefined,
            startTime: currentTimeRange.startTime,
            endTime: currentTimeRange.endTime,
            query: currentQuery || undefined,
            filters,
            sortBy: currentSort.sortBy,
            sortDirection: currentSort.sortDirection,
            limit: pageSize,
            offset,
          }),
          getLogFacets(team.id, {
            sourceId: currentSourceId || undefined,
            startTime: currentTimeRange.startTime,
            endTime: currentTimeRange.endTime,
            query: currentQuery || undefined,
            filters,
            fields: FACET_FIELDS,
            limit: 10,
          }),
          getLogHistogram(team.id, {
            sourceId: currentSourceId || undefined,
            startTime: currentTimeRange.startTime,
            endTime: currentTimeRange.endTime,
            query: currentQuery || undefined,
            filters,
            interval: "5m",
          }),
        ]);

        if (!active) return;

        setLogs(result.logs);
        setTotal(result.total);
        setExecution(`${result.total} logs in ${result.executionTimeMs}ms`);
        if (explanation?.sql) setSqlPreview(explanation.sql);
        setFacets(facetResult.facets);
        setHistogram(histogramResult.buckets);
      } catch (loadError) {
        if (active) {
          setError(loadError instanceof Error ? loadError.message : "Could not load logs");
          setLogs([]);
          setTotal(0);
          setFacets([]);
          setHistogram([]);
        }
      } finally {
        if (active) {
          setLoading(false);
          setFacetLoading(false);
          setHistogramLoading(false);
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
    currentSourceId,
    currentExclusions,
    currentFacetSelections,
    currentTimeRange.endTime,
    currentTimeRange.startTime,
    pageSize,
    reloadToken,
    team.id,
  ]);

  function updateSearch(next: {
    query?: string;
    page?: number;
    pageSize?: number;
    sourceId?: string;
    exclusions?: ExclusionChip[];
    facets?: FacetSelection[];
    columns?: string[];
    startTime?: string;
    endTime?: string;
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
    const sourceId = next.sourceId ?? currentSourceId;
    const exclusions = next.exclusions ?? currentExclusions;
    const facets = next.facets ?? currentFacetSelections;
    const columns = next.columns ?? currentColumns;
    const startTime = next.startTime ?? currentTimeRange.startTime;
    const endTime = next.endTime ?? currentTimeRange.endTime;
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
    if (sourceId) params.set("sourceId", sourceId);
    else params.delete("sourceId");
    params.delete("exclude");
    for (const exclusion of exclusions) {
      params.append(
        "exclude",
        `${encodeURIComponent(exclusion.field)}${EXCLUDE_PARAM_SEPARATOR}${encodeURIComponent(exclusion.value)}`,
      );
    }
    params.delete("facet");
    for (const facet of facets) {
      params.append(
        "facet",
        `${encodeURIComponent(facet.field)}${EXCLUDE_PARAM_SEPARATOR}${encodeURIComponent(facet.value)}`,
      );
    }
    params.delete("col");
    for (const column of columns) {
      params.append("col", encodeURIComponent(column));
    }
    if (startTime) params.set("startTime", startTime);
    else params.delete("startTime");
    if (endTime) params.set("endTime", endTime);
    else params.delete("endTime");
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
    filters: { level: string; service: string; host: string; sourceId: string },
    timeRange: { startTime: string; endTime: string },
    sort: { sortBy: "timestamp" | "level" | "service" | "host"; sortDirection: "asc" | "desc" },
    nextPageSize: number,
  ) {
    updateSearch({
      query: query.trim(),
      page: 1,
      pageSize: nextPageSize,
      sourceId: filters.sourceId,
      startTime: timeRange.startTime,
      endTime: timeRange.endTime,
      level: filters.level,
      service: filters.service,
      host: filters.host,
      sortBy: sort.sortBy,
      sortDirection: sort.sortDirection,
    });
  }

  useEffect(() => {
    if (!selectedLog) return;
    setContextLoading(true);
    void getLogContext({
      teamId: team.id,
      sourceId: selectedLog.sourceId,
      timestamp: selectedLog.timestamp,
      service: selectedLog.service,
      host: selectedLog.host,
      scope: contextScope,
    })
      .then((context) => {
        setContextBefore(context.before);
        setContextAfter(context.after);
      })
      .catch(() => {
        setContextBefore([]);
        setContextAfter([]);
      })
      .finally(() => setContextLoading(false));
  }, [contextScope, selectedLog, team.id]);

  return (
    <div className="space-y-4 lg:space-y-6">
      <SearchPanel
        onSearch={handleSearch}
        sqlPreview={sqlPreview}
        currentQuery={currentQuery}
        currentFilters={currentFilters}
        currentTimeRange={currentTimeRange}
        currentSourceId={currentSourceId}
        currentExclusions={currentExclusions}
        currentSort={currentSort}
        pageSize={pageSize}
        onRemoveChip={(chip) => {
          if (chip === "query") {
            updateSearch({ page: 1, query: "" });
            return;
          }
          if (chip === "level") {
            updateSearch({ page: 1, level: "" });
            return;
          }
          if (chip === "service") {
            updateSearch({ page: 1, service: "" });
            return;
          }
          if (chip === "host") {
            updateSearch({ page: 1, host: "" });
            return;
          }
          if (chip === "source") {
            updateSearch({ page: 1, sourceId: "" });
          }
        }}
        onRemoveExclusion={(index) => {
          const next = currentExclusions.filter((_, idx) => idx !== index);
          updateSearch({ page: 1, exclusions: next });
        }}
      />

      <Card className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-muted">Execution</p>
          <p className="mt-1 font-mono text-base font-semibold text-ink">{execution || `${total} logs`}</p>
        </div>
        <p className="text-xs text-muted">
          Team <span className="font-mono">{team.slug}</span>
        </p>
        <p className="text-xs text-muted">
          Range{" "}
          <span className="font-mono">{new Date(currentTimeRange.startTime).toLocaleString("de-DE")}</span> to{" "}
          <span className="font-mono">{new Date(currentTimeRange.endTime).toLocaleString("de-DE")}</span>
        </p>
        {currentFacetSelections.length > 0 ? (
          <div className="w-full border-t border-line/70 pt-3">
            <p className="mb-2 text-xs uppercase tracking-[0.16em] text-muted">Facet Chips</p>
            <div className="flex flex-wrap gap-2">
              {currentFacetSelections.map((facet, index) => (
                <button
                  key={`${facet.field}:${facet.value}:${index}`}
                  type="button"
                  onClick={() => {
                    const next = currentFacetSelections.filter((_, itemIndex) => itemIndex !== index);
                    updateSearch({ page: 1, facets: next });
                  }}
                  className="rounded-full border border-line px-2 py-1 font-mono text-[11px] text-ink hover:bg-slate-900/5 dark:hover:bg-white/5"
                >
                  {facet.field}:{facet.value} ×
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </Card>

      <HistogramStrip
        buckets={histogram}
        loading={histogramLoading}
        onSelectBucket={(bucket) => updateSearch({ page: 1, startTime: bucket.start, endTime: bucket.end })}
      />

      {loading && <SkeletonTable rows={Math.min(pageSize, 8)} />}

      <div className="grid gap-4 lg:grid-cols-[260px_minmax(0,1fr)_280px]">
        <FacetSidebar
          facets={facets}
          active={currentFacetSelections}
          loading={facetLoading}
          onToggle={(field, value) => {
            const exists = currentFacetSelections.some(
              (item) => item.field === field && item.value === value,
            );
            const next = exists
              ? currentFacetSelections.filter((item) => !(item.field === field && item.value === value))
              : [...currentFacetSelections, { field, value }];
            updateSearch({ page: 1, facets: next });
          }}
        />

        <div>
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
              extraColumns={currentColumns}
              page={currentPage}
              pageSize={pageSize}
              total={total}
              selectedLogId={selectedLog?.id}
              onSelectLog={(log) => setSelectedLog(log)}
              onPageChange={(page) => updateSearch({ page })}
              onPageSizeChange={(nextPageSize) => updateSearch({ page: 1, pageSize: nextPageSize })}
            />
          ) : null}
        </div>

        <FieldExplorer
          fields={discoveredFields}
          selectedColumns={currentColumns}
          onAddColumn={(field) => updateSearch({ columns: [...currentColumns, field] })}
          onAddFilter={(field, value) => {
            const next = [...currentFacetSelections, { field, value }].filter(
              (item, index, allItems) =>
                allItems.findIndex(
                  (candidate) => candidate.field === item.field && candidate.value === item.value,
                ) === index,
            );
            updateSearch({ page: 1, facets: next });
          }}
        />
      </div>

      <LiveTail teamId={team.id} />
      <LogEventDrawer
        log={selectedLog}
        contextBefore={contextLoading ? [] : contextBefore}
        contextAfter={contextLoading ? [] : contextAfter}
        contextScope={contextScope}
        onScopeChange={setContextScope}
        onClose={() => setSelectedLog(null)}
        onFilter={(field, value) => {
          setSelectedLog(null);
          void handleSearch(
            currentQuery,
            {
              level: field === "level" ? value : currentFilters.level,
              service: field === "service" ? value : currentFilters.service,
              host: field === "host" ? value : currentFilters.host,
              sourceId: currentSourceId,
            },
            currentTimeRange,
            currentSort,
            pageSize,
          );
        }}
        onExclude={(_field, _value) => {
          const next = [...currentExclusions, { field: _field, value: _value }].filter(
            (item, index, arr) =>
              arr.findIndex(
                (candidate) => candidate.field === item.field && candidate.value === item.value,
              ) === index,
          );
          updateSearch({ page: 1, exclusions: next });
          setSelectedLog(null);
        }}
      />
    </div>
  );
}
