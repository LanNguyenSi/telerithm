import OpenAI from "openai";
import type { LogFilter, NLQTranslation } from "../../types/domain.js";
import { config } from "../../config/index.js";
import { logger } from "../../logger.js";

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
  private openai: OpenAI | null = null;
  private useLLM: boolean = false;

  constructor() {
    // Only initialize OpenAI if API key is provided
    if (config.openaiApiKey) {
      this.openai = new OpenAI({
        apiKey: config.openaiApiKey,
      });
      this.useLLM = true;
      logger.info("AI Service initialized with OpenAI LLM support");
    } else {
      logger.warn("AI Service initialized without OpenAI API key - using heuristic fallback");
    }
  }

  async translateQuery(naturalQuery: string, teamId: string): Promise<NLQTranslation> {
    if (this.useLLM && this.openai) {
      try {
        return await this.translateQueryWithLLM(naturalQuery, teamId);
      } catch (error) {
        logger.error({ error }, "LLM translation failed, falling back to heuristic");
        return this.translateQueryHeuristicPublic(naturalQuery, teamId);
      }
    }

    // Fallback to heuristic if no LLM available
    return this.translateQueryHeuristicPublic(naturalQuery, teamId);
  }

  private async translateQueryWithLLM(naturalQuery: string, teamId: string): Promise<NLQTranslation> {
    const systemPrompt = `You are a ClickHouse SQL expert for a log aggregation system.

The logs table schema is:
- team_id String (REQUIRED in WHERE clause)
- source_id String
- timestamp DateTime64(3)
- level LowCardinality(String) - values: "debug", "info", "warn", "error", "fatal"
- service LowCardinality(String) - application/service name (e.g. "payment-service", "auth-service", "api-gateway")
- host LowCardinality(String) - hostname
- message String - log message text
- fields Map(String, String) - additional key-value metadata

STRICT RULES:
1. Only generate SELECT statements
2. MUST include "WHERE team_id = '${teamId}'" in every query
3. Only query the "logs" table
4. Use ORDER BY timestamp DESC for recent logs
5. Add LIMIT clause (default 100, max 1000)
6. For time ranges, use ClickHouse interval syntax: "timestamp > now() - INTERVAL 1 HOUR"
7. To access map fields, use: fields['key_name']
8. ALWAYS use ILIKE instead of LIKE for case-insensitive matching on message, service, and host
9. When user asks about a service (payment, auth, gateway), filter on service ILIKE '%name%', NOT on message
10. Combine filters example: service ILIKE '%payment%' AND level = 'error'

Return ONLY valid JSON with this structure:
{
  "sql": "SELECT * FROM logs WHERE ...",
  "explanation": "Human-readable explanation of the query"
}`;

    const response = await this.openai!.chat.completions.create({
      model: "gpt-4o-mini", // cheap + fast
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: naturalQuery },
      ],
      response_format: { type: "json_object" },
      temperature: 0.1, // Low temperature for consistency
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error("No response from LLM");
    }

    const parsed = JSON.parse(content) as { sql: string; explanation: string };

    // Security validation
    this.validateSQL(parsed.sql, teamId);

    return {
      sql: parsed.sql,
      explanation: parsed.explanation,
      filtersApplied: [], // LLM generates SQL directly, not filters
    };
  }

  private validateSQL(sql: string, teamId: string): void {
    const upperSQL = sql.toUpperCase();

    // Only allow SELECT
    if (!upperSQL.startsWith("SELECT")) {
      throw new Error("Only SELECT statements are allowed");
    }

    // Prevent dangerous operations
    const forbidden = ["DROP", "DELETE", "INSERT", "UPDATE", "TRUNCATE", "ALTER", "CREATE"];
    for (const keyword of forbidden) {
      if (upperSQL.includes(keyword)) {
        throw new Error(`Forbidden SQL keyword: ${keyword}`);
      }
    }

    // Must query only logs table
    if (!upperSQL.includes("FROM LOGS")) {
      throw new Error("Only queries to 'logs' table are allowed");
    }

    // Must include team_id filter
    if (!sql.includes(`team_id = '${teamId}'`)) {
      throw new Error("Query must include team_id filter");
    }
  }

  public translateQueryHeuristicPublic(naturalQuery: string, teamId: string): NLQTranslation {
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

    // Level detection
    if (lower.includes("error")) {
      filters.push({ field: "level", operator: "eq", value: "error" });
    }
    if (lower.includes("warn")) {
      filters.push({ field: "level", operator: "eq", value: "warn" });
    }

    // Service detection
    const serviceMatch = lower.match(/(?:service|from)\s+([a-z0-9-]+)/);
    if (serviceMatch) {
      filters.push({ field: "service", operator: "contains", value: serviceMatch[1] });
    }

    // Fallback: Try to find service name from tokens
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
        filters.push({ field: "service", operator: "contains", value: candidate });
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
