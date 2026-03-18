"use client";

import { useEffect, useState } from "react";
import { LiveTail } from "@/components/logs/live-tail";
import { LogTable } from "@/components/logs/log-table";
import { SearchPanel } from "@/components/logs/search-panel";
import { Card } from "@/components/ui/card";
import { getLogs, getNaturalExplanation, getTeams, login } from "@/lib/api/client";
import type { LogEntry, Team } from "@/types";

export function LogExplorer() {
  const [team, setTeam] = useState<Team | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [sqlPreview, setSqlPreview] = useState("");
  const [execution, setExecution] = useState("");

  useEffect(() => {
    async function bootstrap() {
      const auth = await login();
      const { teams } = await getTeams(auth.token);
      const currentTeam = teams[0];
      setTeam(currentTeam);
      const result = await getLogs(currentTeam.id);
      setLogs(result.logs);
      setExecution(`${result.total} logs in ${result.executionTimeMs}ms`);
    }

    void bootstrap();
  }, []);

  async function handleSearch(query: string) {
    if (!team) {
      return;
    }
    const [translation, result] = await Promise.all([
      getNaturalExplanation(team.id, query),
      getLogs(team.id, query),
    ]);
    setSqlPreview(translation.sql);
    setLogs(result.logs);
    setExecution(`${result.total} logs in ${result.executionTimeMs}ms`);
  }

  if (!team) {
    return <Card>Loading workspace...</Card>;
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

