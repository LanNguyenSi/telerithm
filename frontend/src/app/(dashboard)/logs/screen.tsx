"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { FacetSidebar } from "@/components/logs/facet-sidebar";
import { FieldExplorer } from "@/components/logs/field-explorer";
import { HistogramStrip } from "@/components/logs/histogram-strip";
import { LiveTail } from "@/components/logs/live-tail";
import { LogEventDrawer } from "@/components/logs/log-event-drawer";
import { PatternTable } from "@/components/logs/pattern-table";
import { SavedViewBar } from "@/components/logs/saved-view-bar";
import { LogTable } from "@/components/logs/log-table";
import { SearchPanel } from "@/components/logs/search-panel";
import { Card } from "@/components/ui/card";
import { SkeletonTable } from "@/components/ui/skeleton";
import {
  createSavedLogView,
  deleteSavedLogView,
  duplicateSavedLogView,
  getLogContext,
  getLogFacets,
  getLogHistogram,
  getLogPatterns,
  getLogs,
  getNaturalExplanation,
  getSavedLogViews,
  updateSavedLogView,
} from "@/lib/api/client";
import type {
  LogEntry,
  LogFacet,
  LogHistogramBucket,
  LogPattern,
  NaturalQueryPlan,
  SavedLogView,
  SavedLogViewDefinition,
  Team,
} from "@/types";

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

export function LogExplorer({ team, token }: { team: Team; token: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [aiPlan, setAiPlan] = useState<NaturalQueryPlan | null>(null);
  const [execution, setExecution] = useState("");
  const [lastRequestId, setLastRequestId] = useState("");
  const [isPartial, setIsPartial] = useState(false);
  const [nextPageToken, setNextPageToken] = useState<string | undefined>(undefined);
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
  const [patterns, setPatterns] = useState<LogPattern[]>([]);
  const [patternsLoading, setPatternsLoading] = useState(false);
  const [savedViews, setSavedViews] = useState<SavedLogView[]>([]);
  const [savedViewsLoading, setSavedViewsLoading] = useState(false);
  const [savedViewsError, setSavedViewsError] = useState<string | null>(null);
  const [defaultHydrated, setDefaultHydrated] = useState(false);
  const [fallbackRange] = useState(defaultTimeRange);

  const currentQuery = searchParams.get("q")?.trim() ?? "";
  const currentMode = searchParams.get("mode") === "patterns" ? "patterns" : "raw";
  const currentPageToken = searchParams.get("pageToken") ?? "";
  const currentViewId = searchParams.get("viewId") ?? "";
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
  const currentDefinition = useMemo<SavedLogViewDefinition>(
    () => ({
      mode: currentMode,
      startTime: currentTimeRange.startTime,
      endTime: currentTimeRange.endTime,
      text: currentQuery || undefined,
      sourceId: currentSourceId || undefined,
      filters: [
        ...(currentFilters.level
          ? [{ field: "level", operator: "eq" as const, value: currentFilters.level }]
          : []),
        ...(currentFilters.service
          ? [{ field: "service", operator: "contains" as const, value: currentFilters.service }]
          : []),
        ...(currentFilters.host
          ? [{ field: "host", operator: "contains" as const, value: currentFilters.host }]
          : []),
      ],
      columns: currentColumns,
      sortBy: currentSort.sortBy,
      sortDirection: currentSort.sortDirection,
      facets: currentFacetSelections,
      exclusions: currentExclusions,
      pageSize,
    }),
    [
      currentColumns,
      currentExclusions,
      currentFacetSelections,
      currentFilters.host,
      currentFilters.level,
      currentFilters.service,
      currentMode,
      currentQuery,
      currentSort.sortBy,
      currentSort.sortDirection,
      currentSourceId,
      currentTimeRange.endTime,
      currentTimeRange.startTime,
      pageSize,
    ],
  );
  const selectedView = useMemo(
    () => savedViews.find((view) => view.id === currentViewId) ?? null,
    [currentViewId, savedViews],
  );
  const hasUnsavedChanges = useMemo(() => {
    if (!selectedView) return false;
    return JSON.stringify(selectedView.definition) !== JSON.stringify(currentDefinition);
  }, [currentDefinition, selectedView]);

  useEffect(() => {
    let active = true;
    setSavedViewsLoading(true);
    setSavedViewsError(null);

    void getSavedLogViews(team.id, token)
      .then((response) => {
        if (!active) return;
        setSavedViews(response.views);
      })
      .catch((loadError) => {
        if (!active) return;
        setSavedViews([]);
        setSavedViewsError(loadError instanceof Error ? loadError.message : "Could not load saved views");
      })
      .finally(() => {
        if (!active) return;
        setSavedViewsLoading(false);
      });

    return () => {
      active = false;
    };
  }, [team.id, token]);

  useEffect(() => {
    let active = true;

    async function loadResults() {
      setLoading(true);
      setFacetLoading(true);
      setHistogramLoading(true);
      setPatternsLoading(true);
      setError(null);
      setAiPlan(null);
      setExecution("");
      setLastRequestId("");
      setIsPartial(false);

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
        const [explanation, result, facetResult, histogramResult, patternResult] = await Promise.all([
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
            pageToken: currentPageToken || undefined,
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
          getLogPatterns(team.id, {
            sourceId: currentSourceId || undefined,
            startTime: currentTimeRange.startTime,
            endTime: currentTimeRange.endTime,
            query: currentQuery || undefined,
            filters,
            groupBy: "service_level",
            limit: 50,
          }),
        ]);

        if (!active) return;

        setLogs(result.logs);
        setTotal(result.total);
        setExecution(`${result.total} logs in ${result.executionTimeMs}ms`);
        setLastRequestId(result.requestId);
        setIsPartial(result.partial);
        setNextPageToken(result.nextPageToken);
        if (explanation) setAiPlan(explanation);
        setFacets(facetResult.facets);
        setHistogram(histogramResult.buckets);
        setPatterns(patternResult.patterns);
      } catch (loadError) {
        if (active) {
          setError(loadError instanceof Error ? loadError.message : "Could not load logs");
          setLogs([]);
          setTotal(0);
          setFacets([]);
          setHistogram([]);
          setPatterns([]);
          setNextPageToken(undefined);
        }
      } finally {
        if (active) {
          setLoading(false);
          setFacetLoading(false);
          setHistogramLoading(false);
          setPatternsLoading(false);
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
    currentPageToken,
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

  function applySavedView(view: SavedLogView) {
    updateSearch({
      query: view.definition.text ?? "",
      mode: view.definition.mode ?? "raw",
      page: 1,
      pageSize: view.definition.pageSize ?? DEFAULT_PAGE_SIZE,
      sourceId: view.definition.sourceId ?? "",
      exclusions: view.definition.exclusions ?? [],
      facets: view.definition.facets ?? [],
      columns: view.definition.columns ?? [],
      startTime: view.definition.startTime ?? fallbackRange.startTime,
      endTime: view.definition.endTime ?? fallbackRange.endTime,
      level: String(
        view.definition.filters.find((item) => item.field === "level" && item.operator === "eq")?.value ?? "",
      ),
      service: String(
        view.definition.filters.find((item) => item.field === "service" && item.operator === "contains")
          ?.value ?? "",
      ),
      host: String(
        view.definition.filters.find((item) => item.field === "host" && item.operator === "contains")
          ?.value ?? "",
      ),
      sortBy: view.definition.sortBy ?? DEFAULT_SORT.sortBy,
      sortDirection: view.definition.sortDirection ?? DEFAULT_SORT.sortDirection,
      viewId: view.id,
    });
  }

  useEffect(() => {
    if (defaultHydrated) return;
    if (currentViewId) {
      setDefaultHydrated(true);
      return;
    }
    if (savedViewsLoading) return;
    const defaultView = savedViews.find((view) => view.isDefault);
    if (!defaultView) {
      setDefaultHydrated(true);
      return;
    }
    applySavedView(defaultView);
    setDefaultHydrated(true);
  }, [currentViewId, defaultHydrated, savedViews, savedViewsLoading]);

  function updateSearch(next: {
    query?: string;
    mode?: "raw" | "patterns";
    pageToken?: string;
    viewId?: string;
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
    const mode = next.mode ?? currentMode;
    const pageToken =
      next.pageToken ?? (next.page !== undefined && next.page !== currentPage ? "" : currentPageToken);
    const viewId = next.viewId ?? currentViewId;
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
    if (mode === "patterns") params.set("mode", "patterns");
    else params.delete("mode");
    if (pageToken) params.set("pageToken", pageToken);
    else params.delete("pageToken");
    if (viewId) params.set("viewId", viewId);
    else params.delete("viewId");
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
      {savedViewsLoading ? null : <SavedViewBar
        views={savedViews}
        selectedId={currentViewId}
        unsaved={hasUnsavedChanges}
        loading={savedViewsLoading}
        onSelect={(id) => {
          if (!id) {
            updateSearch({ viewId: "", page: 1 });
            return;
          }
          const view = savedViews.find((item) => item.id === id);
          if (view) {
            applySavedView(view);
          }
        }}
        onSave={() => {
          const defaultName = `View ${new Date().toLocaleString("de-DE")}`;
          const name = window.prompt("Name der gespeicherten Ansicht", defaultName);
          if (!name) return;
          const isShared = window.confirm("Team-weit teilen?");
          const isDefault = window.confirm("Als Standardansicht setzen?");
          void createSavedLogView(token, {
            teamId: team.id,
            name,
            isShared,
            isDefault,
            definition: currentDefinition,
          })
            .then(async ({ view }) => {
              const { views } = await getSavedLogViews(team.id, token);
              setSavedViews(views);
              applySavedView(view);
            })
            .catch((saveError) =>
              setSavedViewsError(saveError instanceof Error ? saveError.message : "Save failed"),
            );
        }}
        onOverwrite={() => {
          if (!selectedView) return;
          if (!window.confirm(`Ansicht "${selectedView.name}" überschreiben?`)) return;
          void updateSavedLogView(selectedView.id, team.id, token, { definition: currentDefinition })
            .then(async ({ view }) => {
              const { views } = await getSavedLogViews(team.id, token);
              setSavedViews(views);
              applySavedView(view);
            })
            .catch((updateError) =>
              setSavedViewsError(updateError instanceof Error ? updateError.message : "Update failed"),
            );
        }}
        onDuplicate={() => {
          if (!selectedView) return;
          const name = window.prompt("Name für Kopie", `${selectedView.name} (copy)`);
          if (!name) return;
          void duplicateSavedLogView(selectedView.id, token, { teamId: team.id, name })
            .then(async ({ view }) => {
              const { views } = await getSavedLogViews(team.id, token);
              setSavedViews(views);
              applySavedView(view);
            })
            .catch((duplicateError) =>
              setSavedViewsError(
                duplicateError instanceof Error ? duplicateError.message : "Duplicate failed",
              ),
            );
        }}
        onRename={() => {
          if (!selectedView) return;
          const name = window.prompt("Neuer Name", selectedView.name);
          if (!name) return;
          void updateSavedLogView(selectedView.id, team.id, token, { name })
            .then(async ({ view }) => {
              const { views } = await getSavedLogViews(team.id, token);
              setSavedViews(views);
              applySavedView(view);
            })
            .catch((renameError) =>
              setSavedViewsError(renameError instanceof Error ? renameError.message : "Rename failed"),
            );
        }}
        onSetDefault={() => {
          if (!selectedView) return;
          void updateSavedLogView(selectedView.id, team.id, token, { isDefault: true })
            .then(async ({ view }) => {
              const { views } = await getSavedLogViews(team.id, token);
              setSavedViews(views);
              applySavedView(view);
            })
            .catch((defaultError) =>
              setSavedViewsError(defaultError instanceof Error ? defaultError.message : "Set default failed"),
            );
        }}
        onDelete={() => {
          if (!selectedView) return;
          if (!window.confirm(`Ansicht "${selectedView.name}" löschen?`)) return;
          void deleteSavedLogView(selectedView.id, team.id, token)
            .then(async () => {
              const { views } = await getSavedLogViews(team.id, token);
              setSavedViews(views);
              updateSearch({ viewId: "" });
            })
            .catch((deleteError) =>
              setSavedViewsError(deleteError instanceof Error ? deleteError.message : "Delete failed"),
            );
        }}
      />}
      {savedViewsError ? <p className="text-xs text-rose-700">{savedViewsError}</p> : null}

      <SearchPanel
        onSearch={handleSearch}
        aiPlan={aiPlan}
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
        onApplyAiPlan={(plan) => {
          const level = String(
            plan.filtersApplied.find((item) => item.field === "level" && item.operator === "eq")?.value ??
              currentFilters.level,
          );
          const service = String(
            plan.filtersApplied.find((item) => item.field === "service")?.value ?? currentFilters.service,
          );
          const host = String(
            plan.filtersApplied.find((item) => item.field === "host")?.value ?? currentFilters.host,
          );
          const facets = [
            ...currentFacetSelections,
            ...plan.filtersApplied
              .filter(
                (item) =>
                  !["level", "service", "host"].includes(item.field) &&
                  (item.operator === "eq" || item.operator === "contains"),
              )
              .map((item) => ({ field: item.field, value: String(item.value) })),
          ].filter(
            (item, index, allItems) =>
              allItems.findIndex(
                (candidate) => candidate.field === item.field && candidate.value === item.value,
              ) === index,
          );

          updateSearch({
            page: 1,
            level,
            service,
            host,
            facets,
            startTime: plan.inferredTimeRange?.startTime ?? currentTimeRange.startTime,
            endTime: plan.inferredTimeRange?.endTime ?? currentTimeRange.endTime,
          });
        }}
        onDiscardAiPlan={() => setAiPlan(null)}
      />

      <Card className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-muted">Execution</p>
          <p className="mt-1 font-mono text-base font-semibold text-ink">{execution || `${total} logs`}</p>
          {lastRequestId ? (
            <p className="mt-1 font-mono text-[11px] text-muted">
              requestId: {lastRequestId}
              {isPartial ? " (partial)" : ""}
            </p>
          ) : null}
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

      <Card className="flex items-center justify-between gap-3">
        <p className="text-xs uppercase tracking-[0.16em] text-muted">View Mode</p>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => updateSearch({ mode: "raw", page: 1 })}
            className={`rounded-md px-3 py-1 text-xs ${
              currentMode === "raw"
                ? "bg-slate-950 text-white"
                : "border border-line text-ink hover:bg-slate-900/5 dark:hover:bg-white/5"
            }`}
          >
            Raw events
          </button>
          <button
            type="button"
            onClick={() => updateSearch({ mode: "patterns", page: 1 })}
            className={`rounded-md px-3 py-1 text-xs ${
              currentMode === "patterns"
                ? "bg-slate-950 text-white"
                : "border border-line text-ink hover:bg-slate-900/5 dark:hover:bg-white/5"
            }`}
          >
            Patterns
          </button>
        </div>
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
            currentMode === "patterns" ? (
              patterns.length === 0 ? (
                <Card>
                  <div className="py-10 text-center text-sm text-muted">
                    {patternsLoading ? "Loading patterns..." : "No patterns found for current scope."}
                  </div>
                </Card>
              ) : (
                <PatternTable
                  patterns={patterns}
                  onOpenPattern={(pattern) => {
                    const next = [
                      ...currentFacetSelections.filter((item) => item.field !== "__pattern"),
                      { field: "__pattern", value: pattern.signature },
                    ];
                    updateSearch({ mode: "raw", page: 1, facets: next });
                  }}
                  onConvertToFilter={(pattern) => {
                    const next = [
                      ...currentFacetSelections.filter((item) => item.field !== "__pattern"),
                      { field: "__pattern", value: pattern.signature },
                    ];
                    updateSearch({ page: 1, facets: next });
                  }}
                />
              )
            ) : (
              <LogTable
                logs={logs}
                extraColumns={currentColumns}
                page={currentPage}
                pageSize={pageSize}
                total={total}
                selectedLogId={selectedLog?.id}
                onSelectLog={(log) => setSelectedLog(log)}
                onPageChange={(page) => {
                  if (page > currentPage && nextPageToken) {
                    updateSearch({ page, pageToken: nextPageToken });
                    return;
                  }
                  updateSearch({ page, pageToken: "" });
                }}
                onPageSizeChange={(nextPageSize) => updateSearch({ page: 1, pageSize: nextPageSize })}
              />
            )
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

      {currentMode === "raw" ? <LiveTail teamId={team.id} /> : null}
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
