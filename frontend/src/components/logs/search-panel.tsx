"use client";

import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";

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

export function SearchPanel({
  onSearch,
  sqlPreview,
  currentQuery,
  currentFilters,
  currentSort,
  pageSize,
}: {
  onSearch: (
    query: string,
    filters: { level: string; service: string; host: string },
    sort: { sortBy: "timestamp" | "level" | "service" | "host"; sortDirection: "asc" | "desc" },
    pageSize: number,
  ) => Promise<void>;
  sqlPreview?: string;
  currentQuery?: string;
  currentFilters: { level: string; service: string; host: string };
  currentSort: { sortBy: "timestamp" | "level" | "service" | "host"; sortDirection: "asc" | "desc" };
  pageSize: number;
}) {
  const [query, setQuery] = useState("");
  const [level, setLevel] = useState("");
  const [service, setService] = useState("");
  const [host, setHost] = useState("");
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
    setSortValue(`${currentSort.sortBy}:${currentSort.sortDirection}`);
  }, [currentSort.sortBy, currentSort.sortDirection]);

  async function runQuery(q: string) {
    const trimmed = q.trim();
    const [sortBy, sortDirection] = sortValue.split(":") as [
      "timestamp" | "level" | "service" | "host",
      "asc" | "desc",
    ];

    setQuery(trimmed);
    setIsPending(true);
    try {
      await onSearch(
        trimmed,
        { level, service: service.trim(), host: host.trim() },
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
      <p className="text-sm uppercase tracking-[0.24em] text-muted">Natural Language Search</p>

      <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:gap-4">
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
            className="w-full rounded-2xl border border-line bg-white/90 px-4 py-3 text-base text-ink outline-none ring-0 resize-none dark:bg-white/10"
            placeholder="Show me payment failures from the last hour"
          />
          {isPending && (
            <div className="absolute right-3 top-3 flex items-center gap-1.5">
              <span className="inline-flex gap-1">
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-signal [animation-delay:0ms]" />
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-signal [animation-delay:150ms]" />
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-signal [animation-delay:300ms]" />
              </span>
              <span className="text-xs text-signal">AI generating SQL...</span>
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={() => void runQuery(query)}
          disabled={isPending}
          className="shrink-0 rounded-2xl bg-slate-950 px-6 py-3 text-sm font-medium text-white transition hover:bg-slate-800 disabled:opacity-50 sm:self-start sm:py-4"
        >
          {isPending ? "Running..." : "Run query"}
        </button>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-4">
        <label className="text-sm text-muted">
          <span className="mb-1 block">Level</span>
          <select
            value={level}
            onChange={(event) => setLevel(event.target.value)}
            className="w-full rounded-xl border border-line bg-white px-3 py-2.5 text-sm text-ink outline-none focus:border-slate-400 dark:bg-white/10"
          >
            <option value="">All levels</option>
            <option value="fatal">fatal</option>
            <option value="error">error</option>
            <option value="warn">warn</option>
            <option value="info">info</option>
            <option value="debug">debug</option>
          </select>
        </label>

        <label className="text-sm text-muted">
          <span className="mb-1 block">Service</span>
          <input
            value={service}
            onChange={(event) => setService(event.target.value)}
            placeholder="payment"
            className="w-full rounded-xl border border-line bg-white px-3 py-2.5 text-sm text-ink outline-none focus:border-slate-400 dark:bg-white/10"
          />
        </label>

        <label className="text-sm text-muted">
          <span className="mb-1 block">Host</span>
          <input
            value={host}
            onChange={(event) => setHost(event.target.value)}
            placeholder="api-1"
            className="w-full rounded-xl border border-line bg-white px-3 py-2.5 text-sm text-ink outline-none focus:border-slate-400 dark:bg-white/10"
          />
        </label>

        <label className="text-sm text-muted">
          <span className="mb-1 block">Sort</span>
          <select
            value={sortValue}
            onChange={(event) => setSortValue(event.target.value)}
            className="w-full rounded-xl border border-line bg-white px-3 py-2.5 text-sm text-ink outline-none focus:border-slate-400 dark:bg-white/10"
          >
            {SORT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => {
            setLevel("");
            setService("");
            setHost("");
            setSortValue("timestamp:desc");
            void onSearch(
              "",
              { level: "", service: "", host: "" },
              { sortBy: "timestamp", sortDirection: "desc" },
              pageSize,
            );
          }}
          className="rounded-full border border-line bg-white/60 px-3 py-1 text-xs text-muted transition hover:text-ink dark:bg-white/5"
        >
          Reset filters
        </button>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
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
        <div className="mt-3 flex flex-wrap items-center gap-2">
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

      {sqlPreview && (
        <div className="mt-4">
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
            <span>Generated SQL</span>
            <span className="rounded bg-cyan-100 px-1.5 py-0.5 font-mono text-[10px] text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-300">
              AI
            </span>
          </button>
          {sqlOpen && (
            <div className="mt-2 overflow-x-auto rounded-2xl bg-slate-950 p-4 font-mono text-sm text-cyan-200">
              {sqlPreview}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
