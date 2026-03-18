"use client";

import { useState, useTransition } from "react";
import { Card } from "@/components/ui/card";

export function SearchPanel({
  onSearch,
  sqlPreview,
}: {
  onSearch: (query: string) => Promise<void>;
  sqlPreview?: string;
}) {
  const [query, setQuery] = useState("show payment errors");
  const [isPending, startTransition] = useTransition();

  return (
    <Card>
      <p className="text-sm uppercase tracking-[0.24em] text-muted">Natural Search</p>
      <div className="mt-4 flex flex-col gap-4 lg:flex-row">
        <textarea
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          className="min-h-28 flex-1 rounded-2xl border border-line bg-white/90 px-4 py-3 text-base text-ink outline-none ring-0"
          placeholder="Show me payment failures from the last hour"
        />
        <button
          type="button"
          onClick={() =>
            startTransition(async () => {
              await onSearch(query);
            })
          }
          className="rounded-2xl bg-slate-950 px-6 py-4 text-sm font-medium text-white transition hover:bg-slate-800"
        >
          {isPending ? "Searching..." : "Run query"}
        </button>
      </div>
      {sqlPreview ? (
        <div className="mt-5 rounded-2xl bg-slate-950 p-4 font-mono text-sm text-cyan-200">
          {sqlPreview}
        </div>
      ) : null}
    </Card>
  );
}

