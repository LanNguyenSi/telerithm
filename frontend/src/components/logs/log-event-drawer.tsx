"use client";

import { Card } from "@/components/ui/card";
import { decodeHtml, formatDate, levelTone } from "@/lib/utils/format";
import type { LogEntry } from "@/types";

interface LogEventDrawerProps {
  log: LogEntry | null;
  contextBefore: LogEntry[];
  contextAfter: LogEntry[];
  contextScope: "source" | "service" | "host";
  onScopeChange: (scope: "source" | "service" | "host") => void;
  onClose: () => void;
  onFilter: (field: string, value: string) => void;
  onExclude: (field: string, value: string) => void;
}

export function LogEventDrawer({
  log,
  contextBefore,
  contextAfter,
  contextScope,
  onScopeChange,
  onClose,
  onFilter,
  onExclude,
}: LogEventDrawerProps) {
  if (!log) return null;

  const fieldEntries = Object.entries(log.fields ?? {});
  const pretty = JSON.stringify(log, null, 2);

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-slate-950/35 backdrop-blur-sm">
      <aside className="h-full w-full max-w-2xl overflow-y-auto border-l border-line bg-panel p-4 shadow-panel dark:shadow-panel-dark">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.18em] text-muted">Event detail</p>
            <p className="mt-1 font-mono text-xs text-muted">{formatDate(log.timestamp)}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-line px-2 py-1 text-xs text-muted transition hover:text-ink"
          >
            Close
          </button>
        </div>

        <Card className="space-y-3">
          <div className="flex flex-wrap items-center gap-2 font-mono text-xs">
            <span className={levelTone(log.level)}>{log.level.toUpperCase()}</span>
            <span className="rounded bg-slate-900/5 px-1.5 py-0.5 dark:bg-white/5">{decodeHtml(log.service)}</span>
            <span className="text-muted">{decodeHtml(log.host)}</span>
            <span className="text-muted">source {decodeHtml(log.sourceId)}</span>
          </div>
          <p className="whitespace-pre-wrap break-all text-sm text-ink">{decodeHtml(log.message)}</p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => navigator.clipboard.writeText(decodeHtml(log.message))}
              className="rounded-md border border-line px-2 py-1 text-xs text-muted transition hover:text-ink"
            >
              Copy message
            </button>
            <button
              type="button"
              onClick={() => navigator.clipboard.writeText(pretty)}
              className="rounded-md border border-line px-2 py-1 text-xs text-muted transition hover:text-ink"
            >
              Copy JSON
            </button>
          </div>
        </Card>

        <Card className="mt-3">
          <p className="text-xs uppercase tracking-[0.14em] text-muted">Fields</p>
          <div className="mt-2 space-y-2">
            {fieldEntries.length === 0 ? (
              <p className="text-xs text-muted">No structured fields on this event.</p>
            ) : (
              fieldEntries.map(([key, value]) => {
                const text = String(value);
                return (
                  <div key={key} className="rounded-lg border border-line bg-white/60 p-2 dark:bg-white/5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-xs text-muted">{key}</span>
                      <div className="flex gap-1">
                        <button
                          type="button"
                          onClick={() => onFilter(key, text)}
                          className="rounded px-1.5 py-0.5 text-[10px] text-signal transition hover:bg-cyan-100 dark:hover:bg-cyan-900/20"
                        >
                          filter
                        </button>
                        <button
                          type="button"
                          onClick={() => onExclude(key, text)}
                          className="rounded px-1.5 py-0.5 text-[10px] text-danger transition hover:bg-rose-100 dark:hover:bg-rose-900/20"
                        >
                          exclude
                        </button>
                      </div>
                    </div>
                    <p className="mt-1 break-all font-mono text-xs text-ink">{text}</p>
                  </div>
                );
              })
            )}
          </div>
        </Card>

        <Card className="mt-3">
          <p className="text-xs uppercase tracking-[0.14em] text-muted">Surrounding events</p>
          <div className="mt-2 flex flex-wrap gap-1">
            {(["source", "service", "host"] as const).map((scope) => (
              <button
                key={scope}
                type="button"
                onClick={() => onScopeChange(scope)}
                className={`rounded-md border px-2 py-1 text-[11px] transition ${
                  contextScope === scope
                    ? "border-cyan-400 bg-cyan-50 text-cyan-700 dark:bg-cyan-900/20 dark:text-cyan-200"
                    : "border-line text-muted hover:text-ink"
                }`}
              >
                {scope}
              </button>
            ))}
          </div>
          <div className="mt-2 space-y-2">
            {[...contextBefore, ...contextAfter].length === 0 ? (
              <p className="text-xs text-muted">No nearby events found in current context scope.</p>
            ) : (
              [...contextBefore, ...contextAfter].map((entry) => (
                <article key={entry.id} className="rounded-lg border border-line bg-white/60 p-2 dark:bg-white/5">
                  <div className="flex flex-wrap items-center gap-2 text-[11px] font-mono text-muted">
                    <span>{formatDate(entry.timestamp)}</span>
                    <span className={levelTone(entry.level)}>{entry.level}</span>
                    <span>{decodeHtml(entry.service)}</span>
                    <span>{decodeHtml(entry.host)}</span>
                  </div>
                  <p className="mt-1 break-all text-xs text-ink">{decodeHtml(entry.message)}</p>
                </article>
              ))
            )}
          </div>
        </Card>

        <Card className="mt-3">
          <p className="text-xs uppercase tracking-[0.14em] text-muted">Raw JSON</p>
          <pre className="mt-2 overflow-x-auto rounded-lg bg-slate-950 p-3 text-xs text-cyan-200">{pretty}</pre>
        </Card>
      </aside>
    </div>
  );
}
