import OpenAI from "openai";
import type { LogFilter, NLQTranslation } from "../../types/domain.js";
import { config } from "../../config/index.js";
import { logger } from "../../logger.js";

const ALLOWED_OPERATORS: LogFilter["operator"][] = ["eq", "neq", "gt", "lt", "contains"];

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
    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
    const systemPrompt = `You convert natural log queries into a structured explorer plan.
Team ID is "${teamId}".
Do not output SQL.
Return ONLY valid JSON with this exact shape:
{
  "explanation": "string",
  "filtersApplied": [{ "field": "string", "operator": "eq|neq|gt|lt|contains", "value": "string|number" }],
  "inferredTimeRange": { "startTime": "ISO8601", "endTime": "ISO8601" },
  "textTerms": ["string"],
  "warnings": ["string"]
}
Rules:
- Keep filters deterministic and minimal.
- Use known fields where possible: level, service, host, message, sourceId, env, region, status_code, route.
- For service intent use operator "contains".
- inferredTimeRange is optional. If user asks "last hour", use startTime="${oneHourAgo}" and endTime="${now.toISOString()}".
- If uncertain, add a warning and leave ambiguous items in textTerms.`;

    const response = await this.openai!.chat.completions.create({
      model: process.env.OPENAI_MODEL || "llama-3.3-70b-versatile",
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

    const parsed = JSON.parse(content) as Partial<NLQTranslation>;
    const filters = Array.isArray(parsed.filtersApplied)
      ? parsed.filtersApplied
          .map((filter) => this.normalizeFilter(filter))
          .filter((filter): filter is LogFilter => filter !== null)
      : [];

    const inferredTimeRange =
      parsed.inferredTimeRange &&
      this.isIsoDate(parsed.inferredTimeRange.startTime) &&
      this.isIsoDate(parsed.inferredTimeRange.endTime)
        ? parsed.inferredTimeRange
        : undefined;

    return {
      explanation:
        typeof parsed.explanation === "string" && parsed.explanation.trim().length > 0
          ? parsed.explanation
          : "AI interpretation generated from natural-language query.",
      filtersApplied: filters,
      inferredTimeRange,
      textTerms: Array.isArray(parsed.textTerms)
        ? parsed.textTerms.filter(
            (term): term is string => typeof term === "string" && term.trim().length > 0,
          )
        : undefined,
      warnings: Array.isArray(parsed.warnings)
        ? parsed.warnings.filter(
            (warning): warning is string => typeof warning === "string" && warning.trim().length > 0,
          )
        : undefined,
    };
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

    // Service detection — skip stop words after "from" (e.g. "from the last hour")
    const timeWords = new Set(["the", "last", "past", "next", "this", "today", "yesterday", "ago"]);
    const serviceMatch = lower.match(/(?:service|from)\s+([a-z0-9-]+)/);
    if (serviceMatch && !timeWords.has(serviceMatch[1]) && !stopWords.has(serviceMatch[1])) {
      filters.push({ field: "service", operator: "contains", value: serviceMatch[1] });
    }

    // Fallback: Try to find service name from tokens
    if (!filters.some((filter) => filter.field === "service")) {
      const tokens = lower.match(/[a-z0-9-]+/g) ?? [];
      const timeWords2 = new Set([
        "the",
        "last",
        "past",
        "next",
        "this",
        "today",
        "yesterday",
        "ago",
        "hour",
        "hours",
        "minute",
        "minutes",
        "day",
        "days",
      ]);
      const candidate = tokens.find(
        (token) =>
          !stopWords.has(token) &&
          !timeWords2.has(token) &&
          token !== "errors" &&
          token !== "error" &&
          token !== "warnings" &&
          token !== "warning",
      );
      if (candidate) {
        filters.push({ field: "service", operator: "contains", value: candidate });
      }
    }

    return {
      explanation: `Heuristic interpretation for team ${teamId} using level/service intent extracted from natural language.`,
      filtersApplied: filters,
      textTerms: naturalQuery
        .split(/\s+/)
        .map((term) => term.trim())
        .filter((term) => term.length > 2 && !stopWords.has(term.toLowerCase()))
        .slice(0, 5),
      warnings: ["AI fallback mode active: heuristic interpretation was used."],
    };
  }

  private normalizeFilter(filter: unknown): LogFilter | null {
    if (!filter || typeof filter !== "object") return null;
    const candidate = filter as Partial<LogFilter>;
    if (
      typeof candidate.field !== "string" ||
      !ALLOWED_OPERATORS.includes(candidate.operator as LogFilter["operator"])
    ) {
      return null;
    }
    if (typeof candidate.value !== "string" && typeof candidate.value !== "number") {
      return null;
    }
    const normalizedField = candidate.field === "sourceId" ? "source_id" : candidate.field;
    return {
      field: normalizedField,
      operator: candidate.operator as LogFilter["operator"],
      value:
        normalizedField === "level" && typeof candidate.value === "string"
          ? candidate.value.toLowerCase()
          : candidate.value,
    };
  }

  private isIsoDate(value: unknown): value is string {
    return typeof value === "string" && !Number.isNaN(new Date(value).getTime());
  }
}
