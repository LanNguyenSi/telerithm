"use client";

import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Select } from "@/components/ui/select";

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

export function SearchPanel({
  onSearch,
  sqlPreview,
  currentQuery,
  currentFilters,
  currentTimeRange,
  currentSourceId,
  currentExclusions,
  currentSort,
  pageSize,
  onRemoveChip,
  onRemoveExclusion,
}: {
  onSearch: (
    query: string,
    filters: { level: string; service: string; host: string; sourceId: string },
    timeRange: { startTime: string; endTime: string },
    sort: { sortBy: "timestamp" | "level" | "service" | "host"; sortDirection: "asc" | "desc" },
    pageSize: number,
  ) => Promise<void>;
  sqlPreview?: string;
  currentQuery?: string;
  currentFilters: { level: string; service: string; host: string };
  currentTimeRange: { startTime: string; endTime: string };
  currentSourceId: string;
  currentExclusions: Array<{ field: string; value: string }>;
  currentSort: { sortBy: "timestamp" | "level" | "service" | "host"; sortDirection: "asc" | "desc" };
  pageSize: number;
  onRemoveChip: (chip: "query" | "level" | "service" | "host" | "source") => void;
  onRemoveExclusion: (index: number) => void;
}) {
  const [query, setQuery] = useState("");
  const [level, setLevel] = useState("");
  const [service, setService] = useState("");
  const [host, setHost] = useState("");
  const [sourceId, setSourceId] = useState("");
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [sortValue, setSortValue] = useState(`${currentSort.sortBy}:${currentSort.sortDirection}`);
  const [isPending, setIsPending] = useState(false);
  const [history, setHistory] = useState<string[]>([]);
  const [sqlOpen, setSqlOpen] = useState(false);

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
  }, [currentTimeRange.endTime, currentTimeRange.startTime]);

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
    const safeStart = startTime ? new Date(startTime) : new Date(now.getTime() - 60 * 60 * 1000);
    const safeEnd = endTime ? new Date(endTime) : now;
    const normalizedStart = Number.isNaN(safeStart.getTime()) ? new Date(now.getTime() - 60 * 60 * 1000) : safeStart;
    const normalizedEnd = Number.isNaN(safeEnd.getTime()) ? now : safeEnd;
    const fixedEnd = normalizedEnd.getTime() < normalizedStart.getTime() ? new Date(normalizedStart.getTime() + 60 * 1000) : normalizedEnd;

    setQuery(trimmed);
    setIsPending(true);
    try {
      await onSearch(
        trimmed,
        { level, service: service.trim(), host: host.trim(), sourceId: sourceId.trim() },
        { startTime: normalizedStart.toISOString(), endTime: fixedEnd.toISOString() },
        { sortBy, sortDirection },
        pageSize,
      );
      if (trimmed) {
        setHistory((prev) => [trimmed, ...prev.filter((h) => h !== trimmed)].slice(0, HISTORY_LIMIT));
        setSqlOpen(true);
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

        <label className="text-xs text-muted">
          <span className="mb-0.5 block">Source</span>
          <input
            value={sourceId}
            onChange={(event) => setSourceId(event.target.value)}
            placeholder="source-id"
            className="w-full rounded-lg border border-line bg-white px-3 py-2 text-sm text-ink outline-none focus:border-slate-400 dark:bg-white/10"
          />
        </label>
      </div>

      <div className="mt-2 grid gap-2 md:grid-cols-4">
        <label className="text-xs text-muted">
          <span className="mb-0.5 block">Level</span>
          <Select
            value={level}
            onChange={setLevel}
            options={[...LEVEL_OPTIONS]}
          />
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
          <Select
            value={sortValue}
            onChange={setSortValue}
            options={[...SORT_OPTIONS]}
          />
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
            const now = new Date();
            const start = new Date(now.getTime() - 60 * 60 * 1000);
            const nextStart = start.toISOString().slice(0, 16);
            const nextEnd = now.toISOString().slice(0, 16);
            setStartTime(nextStart);
            setEndTime(nextEnd);
            void onSearch(
              "",
              { level: "", service: "", host: "", sourceId: "" },
              { startTime: new Date(nextStart).toISOString(), endTime: new Date(nextEnd).toISOString() },
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

      {sqlPreview && (
        <div className="mt-3">
          <button
            type="button"
            onClick={() => setSqlOpen((v) => !v)}
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
              className={`transition-transform ${sqlOpen ? "rotate-90" : ""}`}
            >
              <polyline points="9 18 15 12 9 6" />
            </svg>
            <span>AI interpretation</span>
            <span className="rounded bg-cyan-100 px-1.5 py-0.5 font-mono text-[10px] text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-300">
              AI
            </span>
          </button>
          {sqlOpen && (
            <div className="mt-2 overflow-x-auto rounded-xl bg-slate-950 p-3 font-mono text-xs text-cyan-200">
              {sqlPreview}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
