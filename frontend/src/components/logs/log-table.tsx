import clsx from "clsx";
import { Card } from "@/components/ui/card";
import { formatDate, levelTone } from "@/lib/utils/format";
import type { LogEntry } from "@/types";

export function LogTable({ logs }: { logs: LogEntry[] }) {
  return (
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
              <tr key={log.id} className="border-b border-line/80 bg-white/70 align-top">
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
  );
}

