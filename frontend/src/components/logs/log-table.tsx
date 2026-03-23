import clsx from "clsx";
import { Card } from "@/components/ui/card";
import { PaginationControls } from "@/components/ui/pagination-controls";
import { formatDate, levelTone } from "@/lib/utils/format";
import type { LogEntry } from "@/types";

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
  return (
    <>
      {/* Desktop table */}
      <div className="hidden md:block">
        <Card className="overflow-hidden p-0">
          <div className="overflow-x-auto">
            <table className="min-w-full text-left">
              <thead className="border-b border-line bg-slate-950 text-xs uppercase tracking-[0.18em] text-white">
                <tr>
                  <th className="px-4 py-4">Time</th>
                  <th className="px-4 py-4">Level</th>
                  <th className="px-4 py-4">Service</th>
                  <th className="px-4 py-4">Host</th>
                  <th className="px-4 py-4">Message</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((log) => (
                  <tr key={log.id} className="border-b border-line/80 bg-white/70 align-top dark:bg-white/5">
                    <td className="px-4 py-4 text-sm text-muted">{formatDate(log.timestamp)}</td>
                    <td className={clsx("px-4 py-4 text-sm font-semibold uppercase", levelTone(log.level))}>
                      {log.level}
                    </td>
                    <td className="px-4 py-4 font-medium text-ink">{log.service}</td>
                    <td className="px-4 py-4 font-mono text-sm text-muted">{log.host}</td>
                    <td className="px-4 py-4 text-sm text-ink">{log.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      {/* Mobile cards */}
      <div className="space-y-3 md:hidden">
        {logs.map((log) => (
          <article
            key={log.id}
            className="rounded-[24px] border border-line bg-panel/85 p-4 shadow-panel backdrop-blur"
          >
            <div className="flex items-start justify-between gap-3">
              <span className={clsx("text-xs font-semibold uppercase", levelTone(log.level))}>
                {log.level}
              </span>
              <span className="text-xs text-muted">{formatDate(log.timestamp)}</span>
            </div>
            <p className="mt-2 text-sm font-medium text-ink">{log.message}</p>
            <div className="mt-2 flex flex-wrap gap-2 text-xs text-muted">
              <span className="rounded-full bg-slate-900/5 px-2 py-0.5 dark:bg-white/5">{log.service}</span>
              <span className="font-mono">{log.host}</span>
            </div>
          </article>
        ))}
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
