import type { DashboardSummary, LogEntry, LogFilter, LogQuery, LogSearchResult } from "../../types/domain.js";
import { store } from "../../repositories/in-memory-store.js";
import { AIService } from "../ai/ai-service.js";

function matchesFilter(log: LogEntry, filter: LogFilter): boolean {
  const sourceValue =
    filter.field in log ? (log[filter.field as keyof LogEntry] as unknown) : log.fields[filter.field];

  if (sourceValue === undefined) {
    return false;
  }

  if (filter.operator === "contains") {
    return String(sourceValue).toLowerCase().includes(String(filter.value).toLowerCase());
  }

  if (filter.operator === "eq") {
    return String(sourceValue) === String(filter.value);
  }

  if (filter.operator === "neq") {
    return String(sourceValue) !== String(filter.value);
  }

  const left = Number(sourceValue);
  const right = Number(filter.value);
  if (Number.isNaN(left) || Number.isNaN(right)) {
    return false;
  }
  return filter.operator === "gt" ? left > right : left < right;
}

export class QueryService {
  private readonly aiService = new AIService();

  search(query: LogQuery): LogSearchResult {
    const startedAt = performance.now();
    let filters = query.filters ?? [];
    let executedQuery = query.query ?? "SELECT * FROM logs";

    if (query.queryType === "natural" && query.query) {
      const translation = this.aiService.translateQuery(query.query, query.teamId);
      filters = [...filters, ...translation.filtersApplied];
      executedQuery = translation.sql;
    }

    let logs = store.logs.filter((log) => log.teamId === query.teamId);

    if (query.sourceId) {
      logs = logs.filter((log) => log.sourceId === query.sourceId);
    }
    if (query.startTime) {
      logs = logs.filter((log) => log.timestamp >= query.startTime!);
    }
    if (query.endTime) {
      logs = logs.filter((log) => log.timestamp <= query.endTime!);
    }
    if (query.query && query.queryType === "sql") {
      const term = query.query.toLowerCase();
      logs = logs.filter((log) =>
        [log.message, log.service, log.host, log.level].some((value) =>
          value.toLowerCase().includes(term),
        ),
      );
      executedQuery = `SELECT * FROM logs WHERE team_id = '${query.teamId}' /* full text fallback */`;
    }

    if (filters.length > 0) {
      logs = logs.filter((log) => filters.every((filter) => matchesFilter(log, filter)));
    }

    logs.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
    const total = logs.length;
    const offset = query.offset ?? 0;
    const limit = query.limit ?? 100;

    return {
      logs: logs.slice(offset, offset + limit),
      total,
      query: executedQuery,
      executionTimeMs: Math.round((performance.now() - startedAt) * 100) / 100,
      cached: false,
    };
  }

  explainNaturalQuery(teamId: string, naturalQuery: string) {
    return this.aiService.translateQuery(naturalQuery, teamId);
  }

  getDashboardSummary(teamId: string): DashboardSummary {
    const teamLogs = store.logs.filter((log) => log.teamId === teamId);
    const errorCount = teamLogs.filter((log) => log.level === "error" || log.level === "fatal").length;
    const serviceMap = new Map<string, number>();

    for (const log of teamLogs) {
      serviceMap.set(log.service, (serviceMap.get(log.service) ?? 0) + 1);
    }

    return {
      teamId,
      totalLogs: teamLogs.length,
      errorRate: teamLogs.length === 0 ? 0 : Number(((errorCount / teamLogs.length) * 100).toFixed(1)),
      services: [...serviceMap.entries()]
        .map(([service, count]) => ({ service, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 5),
      recentIncidents: store.incidents.slice(0, 5),
    };
  }
}

