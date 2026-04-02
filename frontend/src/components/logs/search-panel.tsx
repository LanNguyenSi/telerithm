"use client";

import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import type { RefreshInterval, RelativeDuration, TimeMode } from "@/hooks/use-log-search";
import type { NaturalQueryPlan } from "@/types";

const HISTORY_LIMIT = 5;
const PRESETS = ["show payment errors", "fatal logs last hour", "warn logs from auth-service"];
const SORT_OPTIONS = [
  { value: "timestamp:desc", label: "Newest first" },
  { value: "timestamp:asc", label: "Oldest first" },
  { value: "service:asc", label: "Service A-Z" },
  { value: "service:desc", label: "Service Z-A" },
  { value: "level:asc", label: "Level A-Z" },
  { value: "host:asc", label: "Host A-Z" },
] as const;
const LEVEL_OPTIONS = [
  { value: "", label: "All levels" },
  { value: "fatal", label: "fatal" },
  { value: "error", label: "error" },
  { value: "warn", label: "warn" },
  { value: "info", label: "info" },
  { value: "debug", label: "debug" },
] as const;
const TIME_RANGE_OPTIONS: ReadonlyArray<{ value: RelativeDuration | "custom"; label: string }> = [
  { value: "5m", label: "Last 5m" },
  { value: "15m", label: "Last 15m" },
  { value: "1h", label: "Last 1h" },
  { value: "6h", label: "Last 6h" },
  { value: "24h", label: "Last 24h" },
  { value: "7d", label: "Last 7d" },
  { value: "custom", label: "Custom range" },
];
const REFRESH_OPTIONS: ReadonlyArray<{ value: RefreshInterval; label: string }> = [
  { value: "off", label: "Refresh off" },
  { value: "10s", label: "Refresh 10s" },
  { value: "30s", label: "Refresh 30s" },
  { value: "1m", label: "Refresh 1m" },
];
const RELATIVE_MS: Record<RelativeDuration, number> = {
  "5m": 5 * 60 * 1000,
  "15m": 15 * 60 * 1000,
  "1h": 60 * 60 * 1000,
  "6h": 6 * 60 * 60 * 1000,
  "24h": 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
};

export function SearchPanel({
  onSearch,
  aiPlan,
  currentQuery,
  currentFilters,
  currentTimeRange,
  currentTimeMode,
  currentRelativeDuration,
  currentRefresh,
  currentShareAbsoluteTime,
  currentSourceId,
  currentExclusions,
  currentSort,
  pageSize,
  onRemoveChip,
  onRemoveExclusion,
  onApplyAiPlan,
  onDiscardAiPlan,
}: {
  onSearch: (
    query: string,
    filters: { level: string; service: string; host: string; sourceId: string },
    timeRange: { startTime: string; endTime: string },
    timeSelection: {
      mode: TimeMode;
      relativeDuration: RelativeDuration;
      refresh: RefreshInterval;
      shareAbsoluteTime: boolean;
    },
    sort: { sortBy: "timestamp" | "level" | "service" | "host"; sortDirection: "asc" | "desc" },
    pageSize: number,
  ) => Promise<void>;
  aiPlan?: NaturalQueryPlan | null;
  currentQuery?: string;
  currentFilters: { level: string; service: string; host: string };
  currentTimeRange: { startTime: string; endTime: string };
  currentTimeMode: TimeMode;
  currentRelativeDuration: RelativeDuration;
  currentRefresh: RefreshInterval;
  currentShareAbsoluteTime: boolean;
  currentSourceId: string;
  currentExclusions: Array<{ field: string; value: string }>;
  currentSort: { sortBy: "timestamp" | "level" | "service" | "host"; sortDirection: "asc" | "desc" };
  pageSize: number;
  onRemoveChip: (chip: "query" | "level" | "service" | "host" | "source") => void;
  onRemoveExclusion: (index: number) => void;
  onApplyAiPlan?: (plan: NaturalQueryPlan) => void;
  onDiscardAiPlan?: () => void;
}) {
  const [query, setQuery] = useState("");
  const [level, setLevel] = useState("");
  const [service, setService] = useState("");
  const [host, setHost] = useState("");
  const [sourceId, setSourceId] = useState("");
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [timeMode, setTimeMode] = useState<TimeMode>("rel");
  const [relativeDuration, setRelativeDuration] = useState<RelativeDuration>("1h");
  const [refresh, setRefresh] = useState<RefreshInterval>("off");
  const [shareAbsoluteTime, setShareAbsoluteTime] = useState(false);
  const [sortValue, setSortValue] = useState(`${currentSort.sortBy}:${currentSort.sortDirection}`);
  const [isPending, setIsPending] = useState(false);
  const [history, setHistory] = useState<string[]>([]);
  const [aiOpen, setAiOpen] = useState(false);
  const [timeRangeError, setTimeRangeError] = useState<string | null>(null);

  useEffect(() => {
    setQuery(currentQuery ?? "");
  }, [currentQuery]);

  useEffect(() => {
    setLevel(currentFilters.level);
    setService(currentFilters.service);
    setHost(currentFilters.host);
  }, [currentFilters.host, currentFilters.level, currentFilters.service]);

  useEffect(() => {
    setSourceId(currentSourceId);
  }, [currentSourceId]);

  useEffect(() => {
    setStartTime(currentTimeRange.startTime.slice(0, 16));
    setEndTime(currentTimeRange.endTime.slice(0, 16));
    setTimeMode(currentTimeMode);
    setRelativeDuration(currentRelativeDuration);
    setRefresh(currentRefresh);
    setShareAbsoluteTime(currentShareAbsoluteTime);
    // Validate range on load
    const s = new Date(currentTimeRange.startTime).getTime();
    const e = new Date(currentTimeRange.endTime).getTime();
    if (Number.isFinite(s) && Number.isFinite(e) && e - s > 7 * 24 * 60 * 60 * 1000) {
      setTimeRangeError("Time range cannot exceed 7 days. Please narrow your selection.");
    } else {
      setTimeRangeError(null);
    }
  }, [
    currentRefresh,
    currentRelativeDuration,
    currentShareAbsoluteTime,
    currentTimeMode,
    currentTimeRange.endTime,
    currentTimeRange.startTime,
  ]);

  useEffect(() => {
    setSortValue(`${currentSort.sortBy}:${currentSort.sortDirection}`);
  }, [currentSort.sortBy, currentSort.sortDirection]);

  async function runQuery(q: string) {
    const trimmed = q.trim();
    const [sortBy, sortDirection] = sortValue.split(":") as [
      "timestamp" | "level" | "service" | "host",
      "asc" | "desc",
    ];

    const now = new Date();
    let normalizedStart: Date;
    let fixedEnd: Date;
    if (timeMode === "rel") {
      fixedEnd = now;
      normalizedStart = new Date(fixedEnd.getTime() - RELATIVE_MS[relativeDuration]);
    } else {
      const safeStart = startTime ? new Date(startTime) : new Date(now.getTime() - 60 * 60 * 1000);
      const safeEnd = endTime ? new Date(endTime) : now;
      normalizedStart = Number.isNaN(safeStart.getTime())
        ? new Date(now.getTime() - 60 * 60 * 1000)
        : safeStart;
      const normalizedEnd = Number.isNaN(safeEnd.getTime()) ? now : safeEnd;
      fixedEnd =
        normalizedEnd.getTime() < normalizedStart.getTime()
          ? new Date(normalizedStart.getTime() + 60 * 1000)
          : normalizedEnd;
    }

    const MAX_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;
    if (fixedEnd.getTime() - normalizedStart.getTime() > MAX_LOOKBACK_MS) {
      setTimeRangeError("Time range cannot exceed 7 days. Please narrow your selection.");
      return;
    }
    setTimeRangeError(null);

    setQuery(trimmed);
    setIsPending(true);
    try {
      await onSearch(
        trimmed,
        { level, service: service.trim(), host: host.trim(), sourceId: sourceId.trim() },
        { startTime: normalizedStart.toISOString(), endTime: fixedEnd.toISOString() },
        { mode: timeMode, relativeDuration, refresh, shareAbsoluteTime },
        { sortBy, sortDirection },
        pageSize,
      );
      if (trimmed) {
        setHistory((prev) => [trimmed, ...prev.filter((h) => h !== trimmed)].slice(0, HISTORY_LIMIT));
        setAiOpen(true);
      }
    } finally {
      setIsPending(false);
    }
  }

  return (
    <Card>
      <p className="text-xs uppercase tracking-[0.2em] text-muted">Log Query</p>

      <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:gap-3">
        <div className="relative flex-1">
          <textarea
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void runQuery(query);
              }
            }}
            rows={2}
            className="w-full rounded-xl border border-line bg-white/90 px-3 py-2.5 text-sm text-ink outline-none ring-0 resize-none dark:bg-white/10"
            placeholder="Show me payment failures from the last hour"
          />
          {isPending && (
            <div className="absolute right-3 top-3 flex items-center gap-1.5">
              <span className="inline-flex gap-1">
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-signal [animation-delay:0ms]" />
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-signal [animation-delay:150ms]" />
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-signal [animation-delay:300ms]" />
              </span>
              <span className="text-xs text-signal">AI interpreting query...</span>
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={() => void runQuery(query)}
          disabled={isPending}
          className="shrink-0 rounded-xl bg-slate-950 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-slate-800 disabled:opacity-50 sm:self-start"
        >
          {isPending ? "Running..." : "Run query"}
        </button>
      </div>

      <div className="mt-3 grid gap-2 md:grid-cols-3">
        <label className="text-xs text-muted">
          <span className="mb-0.5 block">Time range</span>
          <Select
            value={timeMode === "rel" ? relativeDuration : "custom"}
            onChange={(value) => {
              if (value === "custom") {
                setTimeMode("abs");
                return;
              }
              setTimeMode("rel");
              setRelativeDuration(value as RelativeDuration);
            }}
            options={[...TIME_RANGE_OPTIONS]}
          />
        </label>

        <label className="text-xs text-muted">
          <span className="mb-0.5 block">Refresh</span>
          <Select
            value={refresh}
            onChange={(value) => setRefresh(value as RefreshInterval)}
            options={[...REFRESH_OPTIONS]}
          />
        </label>

        <label className="text-xs text-muted">
          <span className="mb-0.5 block">Source</span>
          <input
            value={sourceId}
            onChange={(event) => setSourceId(event.target.value)}
            placeholder="source-id"
            className="w-full rounded-lg border border-line bg-white px-3 py-2 text-sm text-ink outline-none focus:border-slate-400 dark:bg-white/10"
          />
        </label>

        {timeMode === "abs" ? (
          <>
            <label className="text-xs text-muted">
              <span className="mb-0.5 block">Start</span>
              <input
                type="datetime-local"
                value={startTime}
                onChange={(event) => setStartTime(event.target.value)}
                className="w-full rounded-lg border border-line bg-white px-3 py-2 text-sm text-ink outline-none focus:border-slate-400 dark:bg-white/10"
              />
            </label>

            <label className="text-xs text-muted">
              <span className="mb-0.5 block">End</span>
              <input
                type="datetime-local"
                value={endTime}
                onChange={(event) => setEndTime(event.target.value)}
                className="w-full rounded-lg border border-line bg-white px-3 py-2 text-sm text-ink outline-none focus:border-slate-400 dark:bg-white/10"
              />
            </label>
            <label className="col-span-full flex items-center gap-2 rounded-lg border border-line/70 bg-white/60 px-3 py-2 text-xs text-muted dark:bg-white/5">
              <input
                type="checkbox"
                checked={shareAbsoluteTime}
                onChange={(event) => setShareAbsoluteTime(event.target.checked)}
                className="h-3.5 w-3.5 rounded border-line text-slate-900 focus:ring-slate-400"
              />
              <span>
                Share exact timestamps in URL
                <span className="ml-1 text-[11px] opacity-80">
                  (otherwise stored locally in this browser)
                </span>
              </span>
            </label>
          </>
        ) : null}

        {timeRangeError ? (
          <p className="col-span-full text-xs font-medium text-amber-700 dark:text-amber-400">
            ⚠ {timeRangeError}
          </p>
        ) : null}
      </div>

      <div className="mt-2 grid gap-2 md:grid-cols-4">
        <label className="text-xs text-muted">
          <span className="mb-0.5 block">Level</span>
          <Select value={level} onChange={setLevel} options={[...LEVEL_OPTIONS]} />
        </label>

        <label className="text-xs text-muted">
          <span className="mb-0.5 block">Service</span>
          <input
            value={service}
            onChange={(event) => setService(event.target.value)}
            placeholder="payment"
            className="w-full rounded-lg border border-line bg-white px-3 py-2 text-sm text-ink outline-none focus:border-slate-400 dark:bg-white/10"
          />
        </label>

        <label className="text-xs text-muted">
          <span className="mb-0.5 block">Host</span>
          <input
            value={host}
            onChange={(event) => setHost(event.target.value)}
            placeholder="api-1"
            className="w-full rounded-lg border border-line bg-white px-3 py-2 text-sm text-ink outline-none focus:border-slate-400 dark:bg-white/10"
          />
        </label>

        <label className="text-xs text-muted">
          <span className="mb-0.5 block">Sort</span>
          <Select value={sortValue} onChange={setSortValue} options={[...SORT_OPTIONS]} />
        </label>
      </div>

      <div className="mt-2 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => {
            setLevel("");
            setService("");
            setHost("");
            setSourceId("");
            setSortValue("timestamp:desc");
            setTimeMode("rel");
            setRelativeDuration("1h");
            setRefresh("off");
            setShareAbsoluteTime(false);
            void onSearch(
              "",
              { level: "", service: "", host: "", sourceId: "" },
              {
                startTime: new Date(Date.now() - RELATIVE_MS["1h"]).toISOString(),
                endTime: new Date().toISOString(),
              },
              { mode: "rel", relativeDuration: "1h", refresh: "off", shareAbsoluteTime: false },
              { sortBy: "timestamp", sortDirection: "desc" },
              pageSize,
            );
          }}
          className="rounded-full border border-line bg-white/60 px-3 py-1 text-xs text-muted transition hover:text-ink dark:bg-white/5"
        >
          Reset filters
        </button>
      </div>

      <div className="mt-2 flex flex-wrap gap-1.5">
        <span className="text-xs text-muted self-center">Try:</span>
        {PRESETS.map((preset) => (
          <button
            key={preset}
            type="button"
            onClick={() => void runQuery(preset)}
            disabled={isPending}
            className="rounded-full border border-line bg-white/70 px-3 py-1 text-xs text-ink transition hover:border-slate-400 disabled:opacity-50 dark:bg-white/5"
          >
            {preset}
          </button>
        ))}
      </div>

      {history.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-muted">Recent:</span>
          {history.map((h) => (
            <button
              key={h}
              type="button"
              onClick={() => void runQuery(h)}
              disabled={isPending}
              className="rounded-full border border-line bg-white/50 px-3 py-1 font-mono text-xs text-muted transition hover:text-ink disabled:opacity-50 dark:bg-white/5"
            >
              {h}
            </button>
          ))}
        </div>
      )}

      <div className="mt-2 flex flex-wrap gap-1.5">
        {query && (
          <button
            type="button"
            onClick={() => onRemoveChip("query")}
            className="rounded-full border border-line bg-white/70 px-3 py-1 text-xs text-ink transition hover:border-slate-400 dark:bg-white/5"
          >
            q:{query} x
          </button>
        )}
        {level && (
          <button
            type="button"
            onClick={() => onRemoveChip("level")}
            className="rounded-full border border-line bg-white/70 px-3 py-1 text-xs text-ink transition hover:border-slate-400 dark:bg-white/5"
          >
            level:{level} x
          </button>
        )}
        {service && (
          <button
            type="button"
            onClick={() => onRemoveChip("service")}
            className="rounded-full border border-line bg-white/70 px-3 py-1 text-xs text-ink transition hover:border-slate-400 dark:bg-white/5"
          >
            service:{service} x
          </button>
        )}
        {host && (
          <button
            type="button"
            onClick={() => onRemoveChip("host")}
            className="rounded-full border border-line bg-white/70 px-3 py-1 text-xs text-ink transition hover:border-slate-400 dark:bg-white/5"
          >
            host:{host} x
          </button>
        )}
        {sourceId && (
          <button
            type="button"
            onClick={() => onRemoveChip("source")}
            className="rounded-full border border-line bg-white/70 px-3 py-1 text-xs text-ink transition hover:border-slate-400 dark:bg-white/5"
          >
            source:{sourceId} x
          </button>
        )}
        {currentExclusions.map((exclusion, index) => (
          <button
            key={`${exclusion.field}:${exclusion.value}:${index}`}
            type="button"
            onClick={() => onRemoveExclusion(index)}
            className="rounded-full border border-rose-200 bg-rose-50 px-3 py-1 text-xs text-rose-700 transition hover:border-rose-300 dark:border-rose-900/40 dark:bg-rose-900/20 dark:text-rose-200"
          >
            exclude {exclusion.field}:{exclusion.value} x
          </button>
        ))}
      </div>

      {aiPlan && (
        <div className="mt-3">
          <button
            type="button"
            onClick={() => setAiOpen((v) => !v)}
            className="flex items-center gap-2 text-xs text-muted transition hover:text-ink"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className={`transition-transform ${aiOpen ? "rotate-90" : ""}`}
            >
              <polyline points="9 18 15 12 9 6" />
            </svg>
            <span>AI interpretation</span>
            <span className="rounded bg-cyan-100 px-1.5 py-0.5 font-mono text-[10px] text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-300">
              AI
            </span>
          </button>
          {aiOpen && (
            <div className="mt-2 space-y-2 rounded-xl bg-slate-950 p-3 text-xs text-cyan-200">
              <p className="text-cyan-100">{aiPlan.explanation}</p>
              {aiPlan.textTerms && aiPlan.textTerms.length > 0 ? (
                <p className="font-mono text-cyan-300">terms: {aiPlan.textTerms.join(", ")}</p>
              ) : null}
              {aiPlan.inferredTimeRange ? (
                <p className="font-mono text-cyan-300">
                  inferred range: {new Date(aiPlan.inferredTimeRange.startTime).toLocaleString("de-DE")} -{" "}
                  {new Date(aiPlan.inferredTimeRange.endTime).toLocaleString("de-DE")}
                </p>
              ) : null}
              {aiPlan.filtersApplied.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {aiPlan.filtersApplied.map((filter, index) => (
                    <span
                      key={`${filter.field}:${filter.operator}:${String(filter.value)}:${index}`}
                      className="rounded bg-cyan-900/40 px-2 py-0.5 font-mono text-[11px] text-cyan-200"
                    >
                      {filter.field} {filter.operator} {String(filter.value)}
                    </span>
                  ))}
                </div>
              ) : null}
              {aiPlan.warnings && aiPlan.warnings.length > 0 ? (
                <div className="space-y-1 text-amber-300">
                  {aiPlan.warnings.map((warning) => (
                    <p key={warning}>warning: {warning}</p>
                  ))}
                </div>
              ) : null}
              <div className="flex flex-wrap gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => onApplyAiPlan?.(aiPlan)}
                  className="rounded border border-cyan-600 px-2 py-1 text-[11px] text-cyan-100 hover:bg-cyan-800/30"
                >
                  Apply AI filters
                </button>
                <button
                  type="button"
                  onClick={() => onDiscardAiPlan?.()}
                  className="rounded border border-slate-600 px-2 py-1 text-[11px] text-slate-200 hover:bg-slate-800/30"
                >
                  Discard plan
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
