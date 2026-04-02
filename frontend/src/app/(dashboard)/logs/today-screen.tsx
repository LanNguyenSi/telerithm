"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useLogAuth } from "@/components/logs/log-auth-context";
import { LiveTail } from "@/components/logs/live-tail";
import { LogTable } from "@/components/logs/log-table";
import { Card } from "@/components/ui/card";
import { SkeletonTable } from "@/components/ui/skeleton";
import { Select } from "@/components/ui/select";
import { getLogs } from "@/lib/api/client";
import type { LogEntry } from "@/types";

const LEVEL_OPTIONS = [
  { value: "", label: "All levels" },
  { value: "fatal", label: "fatal" },
  { value: "error", label: "error" },
  { value: "warn", label: "warn" },
  { value: "info", label: "info" },
  { value: "debug", label: "debug" },
] as const;

export function TodayScreen() {
  const { team } = useLogAuth();
  const router = useRouter();
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [level, setLevel] = useState("");
  const [total, setTotal] = useState(0);

  useEffect(() => {
    let active = true;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const now = new Date();
        const start = new Date(now.getTime() - 60 * 60 * 1000);
        const filters = level
          ? [{ field: "level", operator: "eq" as const, value: level }]
          : [];
        const result = await getLogs(team.id, {
          startTime: start.toISOString(),
          endTime: now.toISOString(),
          filters,
          sortBy: "timestamp",
          sortDirection: "desc",
          limit: 50,
          offset: 0,
        });
        if (!active) return;
        setLogs(result.logs);
        setTotal(result.total);
      } catch (loadError) {
        if (active) {
          setError(loadError instanceof Error ? loadError.message : "Could not load logs");
          setLogs([]);
          setTotal(0);
        }
      } finally {
        if (active) setLoading(false);
      }
    }

    void load();
    const interval = setInterval(() => void load(), 30_000);
    return () => { active = false; clearInterval(interval); };
  }, [team.id, level]);

  return (
    <div className="space-y-4">
      <LiveTail teamId={team.id} />

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-muted">Recent Logs</p>
            <p className="mt-0.5 text-xs text-muted">Last hour, auto-refreshing every 30s</p>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs text-muted">Level</label>
            <Select value={level} onChange={setLevel} options={[...LEVEL_OPTIONS]} className="w-32" />
          </div>
        </div>
      </Card>

      {error ? (
        <Card>
          <p className="text-sm text-danger">{error}</p>
        </Card>
      ) : loading ? (
        <SkeletonTable rows={8} />
      ) : logs.length === 0 ? (
        <Card>
          <div className="py-10 text-center">
            <p className="text-sm font-medium text-ink">No logs in the last hour</p>
            <p className="mt-1 text-sm text-muted">Send logs to the ingest endpoint to see them here.</p>
          </div>
        </Card>
      ) : (
        <LogTable
          logs={logs}
          total={total}
          onSelectLog={(log) => router.push(`/logs/${encodeURIComponent(log.id)}`)}
        />
      )}
    </div>
  );
}
