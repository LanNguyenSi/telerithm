"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { useLogAuth } from "@/components/logs/log-auth-context";
import { Card } from "@/components/ui/card";
import { SkeletonCard } from "@/components/ui/skeleton";
import { getLogById, getLogContext } from "@/lib/api/client";
import { decodeHtml, formatDate, levelTone } from "@/lib/utils/format";
import type { LogEntry } from "@/types";

export function LogDetailScreen({
  paramsPromise,
}: {
  paramsPromise: Promise<{ id: string }>;
}) {
  const { id } = use(paramsPromise);
  const logId = decodeURIComponent(id);
  const { team } = useLogAuth();

  const [log, setLog] = useState<LogEntry | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [contextBefore, setContextBefore] = useState<LogEntry[]>([]);
  const [contextAfter, setContextAfter] = useState<LogEntry[]>([]);
  const [contextScope, setContextScope] = useState<"source" | "service" | "host">("source");

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);

    void getLogById(team.id, logId)
      .then(({ log: entry }) => {
        if (active) setLog(entry);
      })
      .catch((loadError) => {
        if (active) setError(loadError instanceof Error ? loadError.message : "Could not load log");
      })
      .finally(() => { if (active) setLoading(false); });

    return () => { active = false; };
  }, [team.id, logId]);

  useEffect(() => {
    if (!log) return;
    void getLogContext({
      teamId: team.id,
      sourceId: log.sourceId,
      timestamp: log.timestamp,
      service: log.service,
      host: log.host,
      scope: contextScope,
    })
      .then((context) => {
        setContextBefore(context.before);
        setContextAfter(context.after);
      })
      .catch(() => {
        setContextBefore([]);
        setContextAfter([]);
      });
  }, [log, contextScope, team.id]);

  if (loading) {
    return (
      <div className="space-y-4">
        <SkeletonCard className="min-h-40" />
        <SkeletonCard className="min-h-32" />
      </div>
    );
  }

  if (error || !log) {
    return (
      <Card>
        <div className="flex flex-col items-center gap-3 py-12 text-center">
          <p className="text-base font-medium text-ink">Log not found</p>
          <p className="max-w-md text-sm text-muted">{error ?? "The requested log entry could not be loaded."}</p>
          <Link
            href="/logs"
            className="rounded-lg bg-slate-950 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-800"
          >
            Back to logs
          </Link>
        </div>
      </Card>
    );
  }

  const fieldEntries = Object.entries(log.fields ?? {});
  const pretty = JSON.stringify(log, null, 2);

  return (
    <div className="space-y-4">
      {/* Header */}
      <Card className="space-y-3">
        <div className="flex flex-wrap items-center gap-2 font-mono text-xs">
          <span className={levelTone(log.level)}>{log.level.toUpperCase()}</span>
          <span className="rounded bg-slate-900/5 px-1.5 py-0.5 dark:bg-white/5">{decodeHtml(log.service)}</span>
          <span className="text-muted">{decodeHtml(log.host)}</span>
          <span className="text-muted">source {decodeHtml(log.sourceId)}</span>
        </div>
        <p className="font-mono text-xs text-muted">{formatDate(log.timestamp)}</p>
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
          <Link
            href={`/logs/search?level=${log.level}&service=${encodeURIComponent(log.service)}`}
            className="rounded-md border border-line px-2 py-1 text-xs text-muted transition hover:text-ink"
          >
            Open in search
          </Link>
        </div>
      </Card>

      {/* Fields */}
      <Card>
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
                      <Link
                        href={`/logs/search?${encodeURIComponent(key)}=${encodeURIComponent(text)}`}
                        className="rounded px-1.5 py-0.5 text-[10px] text-signal transition hover:bg-cyan-100 dark:hover:bg-cyan-900/20"
                      >
                        filter
                      </Link>
                    </div>
                  </div>
                  <p className="mt-1 break-all font-mono text-xs text-ink">{text}</p>
                </div>
              );
            })
          )}
        </div>
      </Card>

      {/* Surrounding events */}
      <Card>
        <p className="text-xs uppercase tracking-[0.14em] text-muted">Surrounding events</p>
        <div className="mt-2 flex flex-wrap gap-1">
          {(["source", "service", "host"] as const).map((scope) => (
            <button
              key={scope}
              type="button"
              onClick={() => setContextScope(scope)}
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
              <Link
                key={entry.id}
                href={`/logs/${encodeURIComponent(entry.id)}`}
                className="block rounded-lg border border-line bg-white/60 p-2 transition hover:border-slate-300 dark:bg-white/5 dark:hover:border-white/20"
              >
                <div className="flex flex-wrap items-center gap-2 text-[11px] font-mono text-muted">
                  <span>{formatDate(entry.timestamp)}</span>
                  <span className={levelTone(entry.level)}>{entry.level}</span>
                  <span>{decodeHtml(entry.service)}</span>
                  <span>{decodeHtml(entry.host)}</span>
                </div>
                <p className="mt-1 break-all text-xs text-ink">{decodeHtml(entry.message)}</p>
              </Link>
            ))
          )}
        </div>
      </Card>

      {/* Raw JSON */}
      <Card>
        <p className="text-xs uppercase tracking-[0.14em] text-muted">Raw JSON</p>
        <pre className="mt-2 overflow-x-auto rounded-lg bg-slate-950 p-3 text-xs text-cyan-200">{pretty}</pre>
      </Card>
    </div>
  );
}
