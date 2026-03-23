"use client";

import clsx from "clsx";
import { useState } from "react";
import { Card } from "@/components/ui/card";
import { PaginationControls } from "@/components/ui/pagination-controls";
import { decodeHtml, formatDate, levelTone } from "@/lib/utils/format";
import type { LogEntry } from "@/types";

const MAX_MSG_LENGTH = 120;

export function LogTable({
  logs,
  page = 1,
  pageSize = 50,
  total = logs.length,
  onPageChange,
  onPageSizeChange,
}: {
  logs: LogEntry[];
  page?: number;
  pageSize?: number;
  total?: number;
  onPageChange?: (page: number) => void;
  onPageSizeChange?: (pageSize: number) => void;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  function toggle(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <>
      {/* Desktop table */}
      <div className="hidden md:block">
        <Card className="overflow-hidden p-0">
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="border-b border-line bg-slate-950 text-[11px] uppercase tracking-[0.14em] text-white">
                <tr>
                  <th className="px-3 py-2.5">Time</th>
                  <th className="px-3 py-2.5">Level</th>
                  <th className="px-3 py-2.5">Service</th>
                  <th className="px-3 py-2.5">Host</th>
                  <th className="px-3 py-2.5">Message</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((log) => {
                  const msg = decodeHtml(log.message);
                  const isLong = msg.length > MAX_MSG_LENGTH;
                  const isOpen = expanded.has(log.id);

                  return (
                    <tr
                      key={log.id}
                      className={clsx(
                        "border-b border-line/80 bg-white/70 dark:bg-white/5",
                        isLong && "cursor-pointer hover:bg-white/90 dark:hover:bg-white/10",
                      )}
                      onClick={isLong ? () => toggle(log.id) : undefined}
                    >
                      <td className="whitespace-nowrap px-3 py-1.5 font-mono text-xs text-muted align-top">
                        {formatDate(log.timestamp)}
                      </td>
                      <td
                        className={clsx(
                          "px-3 py-1.5 font-mono text-xs font-semibold uppercase align-top",
                          levelTone(log.level),
                        )}
                      >
                        {log.level}
                      </td>
                      <td className="px-3 py-1.5 font-mono text-xs text-ink align-top">
                        {decodeHtml(log.service)}
                      </td>
                      <td className="px-3 py-1.5 font-mono text-xs text-muted align-top">
                        {decodeHtml(log.host)}
                      </td>
                      <td className="max-w-xl px-3 py-1.5 text-xs text-ink align-top">
                        {isLong && !isOpen ? (
                          <span>
                            {msg.slice(0, MAX_MSG_LENGTH)}
                            <span className="text-muted">... </span>
                            <span className="text-[10px] text-signal">click to expand</span>
                          </span>
                        ) : (
                          <span className="whitespace-pre-wrap break-all">{msg}</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      {/* Mobile cards */}
      <div className="space-y-2 md:hidden">
        {logs.map((log) => {
          const msg = decodeHtml(log.message);
          const isLong = msg.length > MAX_MSG_LENGTH;
          const isOpen = expanded.has(log.id);

          return (
            <article
              key={log.id}
              className={clsx(
                "rounded-xl border border-line bg-panel/85 p-3 shadow-panel backdrop-blur dark:shadow-panel-dark",
                isLong && "cursor-pointer",
              )}
              onClick={isLong ? () => toggle(log.id) : undefined}
            >
              <div className="flex items-start justify-between gap-3">
                <span className={clsx("font-mono text-[11px] font-semibold uppercase", levelTone(log.level))}>
                  {log.level}
                </span>
                <span className="font-mono text-[11px] text-muted">{formatDate(log.timestamp)}</span>
              </div>
              <p className="mt-1.5 text-sm text-ink">
                {isLong && !isOpen ? (
                  <span>
                    {msg.slice(0, MAX_MSG_LENGTH)}
                    <span className="text-muted">...</span>
                  </span>
                ) : (
                  <span className="whitespace-pre-wrap break-all">{msg}</span>
                )}
              </p>
              <div className="mt-1.5 flex flex-wrap gap-2 text-[11px] text-muted">
                <span className="rounded bg-slate-900/5 px-1.5 py-0.5 font-mono dark:bg-white/5">
                  {decodeHtml(log.service)}
                </span>
                <span className="font-mono">{decodeHtml(log.host)}</span>
              </div>
            </article>
          );
        })}
      </div>

      <PaginationControls
        page={page}
        pageSize={pageSize}
        total={total}
        onPageChange={onPageChange}
        onPageSizeChange={onPageSizeChange}
      />
    </>
  );
}
