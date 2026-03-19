import type { LogFilter, NLQTranslation } from "../../types/domain.js";

function toSqlCondition(filter: LogFilter): string {
  const operatorMap: Record<LogFilter["operator"], string> = {
    eq: "=",
    neq: "!=",
    gt: ">",
    lt: "<",
    contains: "LIKE",
  };
  const operator = operatorMap[filter.operator];
  const value = filter.operator === "contains" ? `'%${String(filter.value)}%'` : `'${String(filter.value)}'`;
  if (["level", "service", "host", "message"].includes(filter.field)) {
    return `${filter.field} ${operator} ${value}`;
  }
  return `fields['${filter.field}'] ${operator} ${value}`;
}

export class AIService {
  translateQuery(naturalQuery: string, teamId: string): NLQTranslation {
    const lower = naturalQuery.toLowerCase();
    const filters: LogFilter[] = [];
    const stopWords = new Set([
      "show",
      "me",
      "all",
      "the",
      "from",
      "last",
      "hour",
      "hours",
      "service",
      "logs",
      "log",
      "find",
      "count",
      "with",
    ]);

    if (lower.includes("error")) {
      filters.push({ field: "level", operator: "eq", value: "error" });
    }
    if (lower.includes("warn")) {
      filters.push({ field: "level", operator: "eq", value: "warn" });
    }

    const serviceMatch = lower.match(/(?:service|from)\s+([a-z0-9-]+)/);
    if (serviceMatch) {
      filters.push({ field: "service", operator: "eq", value: serviceMatch[1] });
    }

    if (!filters.some((filter) => filter.field === "service")) {
      const tokens = lower.match(/[a-z0-9-]+/g) ?? [];
      const candidate = tokens.find(
        (token) =>
          !stopWords.has(token) &&
          token !== "errors" &&
          token !== "error" &&
          token !== "warnings" &&
          token !== "warning",
      );
      if (candidate) {
        filters.push({ field: "service", operator: "eq", value: candidate });
      }
    }

    const sql = [
      "SELECT * FROM logs",
      `WHERE team_id = '${teamId}'`,
      ...filters.map((filter) => `AND ${toSqlCondition(filter)}`),
      "ORDER BY timestamp DESC",
      "LIMIT 100",
    ].join(" ");

    return {
      sql,
      explanation: "Heuristic translation using level and service intent extracted from natural language.",
      filtersApplied: filters,
    };
  }
}
