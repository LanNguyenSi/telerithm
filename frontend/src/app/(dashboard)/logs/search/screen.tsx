"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useLogAuth } from "@/components/logs/log-auth-context";
import { FacetSidebar } from "@/components/logs/facet-sidebar";
import { FieldExplorer } from "@/components/logs/field-explorer";
import { HistogramStrip } from "@/components/logs/histogram-strip";
import { PatternTable } from "@/components/logs/pattern-table";
import { SavedViewBar } from "@/components/logs/saved-view-bar";
import { LogTable } from "@/components/logs/log-table";
import { SearchPanel } from "@/components/logs/search-panel";
import { Card } from "@/components/ui/card";
import { Dialog, useDialog } from "@/components/ui/dialog";
import { SkeletonTable } from "@/components/ui/skeleton";
import {
  createSavedLogView,
  deleteSavedLogView,
  duplicateSavedLogView,
  getLogs,
  getLogFacets,
  getLogHistogram,
  getLogPatterns,
  getNaturalExplanation,
  getSavedLogViews,
  updateSavedLogView,
} from "@/lib/api/client";
import {
  DEFAULT_PAGE_SIZE,
  DEFAULT_SORT,
  FACET_FIELDS,
  useLogSearch,
} from "@/hooks/use-log-search";
import type {
  LogEntry,
  LogFacet,
  LogHistogramBucket,
  LogPattern,
  NaturalQueryPlan,
  SavedLogView,
} from "@/types";

export function SearchScreen() {
  const { team, token } = useLogAuth();
  const router = useRouter();
  const search = useLogSearch();
  const {
    currentQuery,
    currentMode,
    currentPageToken,
    currentViewId,
    currentPage,
    pageSize,
    currentFilters,
    currentSourceId,
    currentExclusions,
    currentFacetSelections,
    currentColumns,
    currentTimeRange,
    currentSort,
    currentDefinition,
    fallbackRange,
    updateSearch,
  } = search;

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
  const dialog = useDialog();

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

  const selectedView = useMemo(
    () => savedViews.find((view) => view.id === currentViewId) ?? null,
    [currentViewId, savedViews],
  );
  const hasUnsavedChanges = useMemo(() => {
    if (!selectedView) return false;
    return JSON.stringify(selectedView.definition) !== JSON.stringify(currentDefinition);
  }, [currentDefinition, selectedView]);

  // Load saved views
  useEffect(() => {
    let active = true;
    setSavedViewsLoading(true);
    setSavedViewsError(null);
    void getSavedLogViews(team.id, token)
      .then((response) => { if (active) setSavedViews(response.views); })
      .catch((loadError) => {
        if (!active) return;
        setSavedViews([]);
        setSavedViewsError(loadError instanceof Error ? loadError.message : "Could not load saved views");
      })
      .finally(() => { if (active) setSavedViewsLoading(false); });
    return () => { active = false; };
  }, [team.id, token]);

  // Main data loading
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
    return () => { active = false; };
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

  // Hydrate default saved view
  useEffect(() => {
    if (defaultHydrated) return;
    if (currentViewId) { setDefaultHydrated(true); return; }
    if (savedViewsLoading) return;
    const defaultView = savedViews.find((view) => view.isDefault);
    if (!defaultView) { setDefaultHydrated(true); return; }
    applySavedView(defaultView);
    setDefaultHydrated(true);
  }, [currentViewId, defaultHydrated, savedViews, savedViewsLoading]);

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

  return (
    <div className="space-y-4 lg:space-y-6">
      {savedViewsLoading ? null : <SavedViewBar
        views={savedViews}
        selectedId={currentViewId}
        unsaved={hasUnsavedChanges}
        loading={savedViewsLoading}
        onSelect={(id) => {
          if (!id) { updateSearch({ viewId: "", page: 1 }); return; }
          const view = savedViews.find((item) => item.id === id);
          if (view) applySavedView(view);
        }}
        onSave={async () => {
          const defaultName = `View ${new Date().toLocaleString("de-DE")}`;
          const result = await dialog.saveView("Ansicht speichern", defaultName);
          if (!result) return;
          void createSavedLogView(token, {
            teamId: team.id,
            name: result.name,
            isShared: result.shared,
            isDefault: result.isDefault,
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
        onOverwrite={async () => {
          if (!selectedView) return;
          const ok = await dialog.confirm(`"${selectedView.name}" überschreiben?`, "Die aktuelle Definition dieser Ansicht wird ersetzt.");
          if (!ok) return;
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
        onDuplicate={async () => {
          if (!selectedView) return;
          const name = await dialog.prompt("Name für Kopie", `${selectedView.name} (copy)`);
          if (!name) return;
          void duplicateSavedLogView(selectedView.id, token, { teamId: team.id, name })
            .then(async ({ view }) => {
              const { views } = await getSavedLogViews(team.id, token);
              setSavedViews(views);
              applySavedView(view);
            })
            .catch((duplicateError) =>
              setSavedViewsError(duplicateError instanceof Error ? duplicateError.message : "Duplicate failed"),
            );
        }}
        onRename={async () => {
          if (!selectedView) return;
          const name = await dialog.prompt("Neuer Name", selectedView.name);
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
        onDelete={async () => {
          if (!selectedView) return;
          const ok = await dialog.confirm(`"${selectedView.name}" löschen?`, "Diese Ansicht wird unwiderruflich gelöscht.");
          if (!ok) return;
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
          if (chip === "query") { updateSearch({ page: 1, query: "" }); return; }
          if (chip === "level") { updateSearch({ page: 1, level: "" }); return; }
          if (chip === "service") { updateSearch({ page: 1, service: "" }); return; }
          if (chip === "host") { updateSearch({ page: 1, host: "" }); return; }
          if (chip === "source") updateSearch({ page: 1, sourceId: "" });
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
          const facetFilters = [
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
            facets: facetFilters,
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
          <span className="font-mono" suppressHydrationWarning>{new Date(currentTimeRange.startTime).toLocaleString("de-DE")}</span> to{" "}
          <span className="font-mono" suppressHydrationWarning>{new Date(currentTimeRange.endTime).toLocaleString("de-DE")}</span>
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
                  className="rounded-lg bg-slate-950 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-800"
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
                onSelectLog={(log) => router.push(`/logs/${encodeURIComponent(log.id)}`)}
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

      <Dialog {...dialog.dialogProps} />
    </div>
  );
}
