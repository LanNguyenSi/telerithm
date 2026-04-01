"use client";

import { Card } from "@/components/ui/card";
import type { LogFacet } from "@/types";

const FACET_LABELS: Record<string, string> = {
  service: "Service",
  level: "Level",
  host: "Host",
  sourceId: "Source",
  env: "Environment",
  region: "Region",
  status_code: "Status Code",
  route: "Route",
};

export function FacetSidebar({
  facets,
  active,
  loading,
  onToggle,
}: {
  facets: LogFacet[];
  active: Array<{ field: string; value: string }>;
  loading: boolean;
  onToggle: (field: string, value: string) => void;
}) {
  return (
    <Card className="h-fit p-4">
      <div className="mb-3">
        <p className="text-xs uppercase tracking-[0.16em] text-muted">Facets</p>
      </div>
      {loading ? (
        <p className="text-xs text-muted">Loading facet counts...</p>
      ) : (
        <div className="space-y-4">
          {facets.map((facet) => (
            <section key={facet.field}>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-ink">
                {FACET_LABELS[facet.field] ?? facet.field}
              </h3>
              <ul className="space-y-1">
                {facet.buckets.slice(0, 8).map((bucket) => {
                  const isActive = active.some(
                    (entry) => entry.field === facet.field && entry.value === bucket.value,
                  );
                  return (
                    <li key={`${facet.field}:${bucket.value}`}>
                      <button
                        type="button"
                        onClick={() => onToggle(facet.field, bucket.value)}
                        className={`flex w-full items-center justify-between rounded-md px-2 py-1 text-left text-xs transition ${
                          isActive
                            ? "bg-slate-950 text-white"
                            : "bg-slate-900/5 text-ink hover:bg-slate-900/10 dark:bg-white/5 dark:hover:bg-white/10"
                        }`}
                      >
                        <span className="truncate pr-2 font-mono">{bucket.value}</span>
                        <span className={`tabular-nums ${isActive ? "text-white/80" : "text-muted"}`}>
                          {bucket.count}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      )}
    </Card>
  );
}
