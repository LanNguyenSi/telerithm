"use client";

import { Card } from "@/components/ui/card";

interface FieldSummary {
  key: string;
  hits: number;
  topValues: string[];
}

export function FieldExplorer({
  fields,
  selectedColumns,
  onAddColumn,
  onAddFilter,
}: {
  fields: FieldSummary[];
  selectedColumns: string[];
  onAddColumn: (field: string) => void;
  onAddFilter: (field: string, value: string) => void;
}) {
  return (
    <Card className="p-4">
      <div className="mb-3">
        <p className="text-xs uppercase tracking-[0.16em] text-muted">Field Explorer</p>
      </div>
      {fields.length === 0 ? (
        <p className="text-xs text-muted">No metadata fields in current result set.</p>
      ) : (
        <div className="space-y-3">
          {fields.map((field) => (
            <section key={field.key} className="rounded-md border border-line/70 p-2">
              <div className="flex items-center justify-between gap-2">
                <p className="font-mono text-xs text-ink">{field.key}</p>
                <p className="text-[11px] text-muted">{field.hits} hits</p>
              </div>
              <div className="mt-2 flex flex-wrap gap-1">
                {field.topValues.map((value) => (
                  <button
                    key={`${field.key}:${value}`}
                    type="button"
                    onClick={() => onAddFilter(field.key, value)}
                    className="rounded bg-slate-900/5 px-2 py-0.5 font-mono text-[11px] text-muted transition hover:bg-slate-900/10 hover:text-ink dark:bg-white/5 dark:hover:bg-white/10"
                  >
                    {value}
                  </button>
                ))}
              </div>
              <div className="mt-2">
                <button
                  type="button"
                  disabled={selectedColumns.includes(field.key)}
                  onClick={() => onAddColumn(field.key)}
                  className="rounded border border-line px-2 py-0.5 text-[11px] text-muted transition enabled:hover:text-ink disabled:opacity-50"
                >
                  {selectedColumns.includes(field.key) ? "Column added" : "Add as column"}
                </button>
              </div>
            </section>
          ))}
        </div>
      )}
    </Card>
  );
}
