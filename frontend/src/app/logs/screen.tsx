"use client";

import { useEffect, useState } from "react";
import { LiveTail } from "@/components/logs/live-tail";
import { LogTable } from "@/components/logs/log-table";
import { SearchPanel } from "@/components/logs/search-panel";
import { Card } from "@/components/ui/card";
import { getLogs, getNaturalExplanation } from "@/lib/api/client";
import type { LogEntry, Team } from "@/types";

export function LogExplorer({ team }: { team: Team }) {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [sqlPreview, setSqlPreview] = useState("");
  const [execution, setExecution] = useState("");

  useEffect(() => {
    async function bootstrap() {
      const result = await getLogs(team.id);
      setLogs(result.logs);
      setExecution(`${result.total} logs in ${result.executionTimeMs}ms`);
    }

    void bootstrap();
  }, [team.id]);

  async function handleSearch(query: string) {
    const [translation, result] = await Promise.all([
      getNaturalExplanation(team.id, query),
      getLogs(team.id, query),
    ]);
    setSqlPreview(translation.sql);
    setLogs(result.logs);
    setExecution(`${result.total} logs in ${result.executionTimeMs}ms`);
  }

  return (
    <div className="space-y-6">
      <SearchPanel onSearch={handleSearch} sqlPreview={sqlPreview} />
      <Card className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm uppercase tracking-[0.24em] text-muted">Execution</p>
          <p className="mt-2 text-lg font-semibold text-ink">{execution}</p>
        </div>
        <p className="text-sm text-muted">
          Team <span className="font-mono">{team.slug}</span>
        </p>
      </Card>
      <LogTable logs={logs} />
      <LiveTail teamId={team.id} />
    </div>
  );
}
