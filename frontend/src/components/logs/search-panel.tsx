"use client";

import { useState } from "react";
import { Card } from "@/components/ui/card";

const HISTORY_LIMIT = 5;
const PRESETS = ["show payment errors", "fatal logs last hour", "warn logs from auth-service"];

export function SearchPanel({
  onSearch,
  sqlPreview,
}: {
  onSearch: (query: string) => Promise<void>;
  sqlPreview?: string;
}) {
  const [query, setQuery] = useState("show payment errors");
  const [isPending, setIsPending] = useState(false);
  const [history, setHistory] = useState<string[]>([]);
  const [sqlOpen, setSqlOpen] = useState(false);

  async function runQuery(q: string) {
    setQuery(q);
    setIsPending(true);
    try {
      await onSearch(q);
      setHistory((prev) => [q, ...prev.filter((h) => h !== q)].slice(0, HISTORY_LIMIT));
      setSqlOpen(true);
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
            className="w-full rounded-2xl border border-line bg-white/90 px-4 py-3 text-base text-ink outline-none ring-0 resize-none"
            placeholder="Show me payment failures from the last hour"
          />
          {isPending && (
            <div className="absolute right-3 top-3 flex items-center gap-1.5">
              <span className="inline-flex gap-1">
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-signal [animation-delay:0ms]" />
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-signal [animation-delay:150ms]" />
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-signal [animation-delay:300ms]" />
              </span>
              <span className="text-xs text-signal">Searching…</span>
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={() => void runQuery(query)}
          disabled={isPending}
          className="shrink-0 rounded-2xl bg-slate-950 px-6 py-3 text-sm font-medium text-white transition hover:bg-slate-800 disabled:opacity-50 sm:self-start sm:py-4"
        >
          {isPending ? "Searching…" : "Run query"}
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
            className="rounded-full border border-line bg-white/70 px-3 py-1 text-xs text-ink transition hover:border-slate-400 disabled:opacity-50"
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
              className="rounded-full border border-line bg-white/50 px-3 py-1 font-mono text-xs text-muted transition hover:text-ink disabled:opacity-50"
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
            <span className="rounded bg-cyan-100 px-1.5 py-0.5 font-mono text-[10px] text-cyan-700">AI</span>
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
