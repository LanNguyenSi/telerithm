import OpenAI from "openai";
import type { LogFilter, LogQueryContext, NLQTranslation } from "../../types/domain.js";
import { config } from "../../config/index.js";
import { logger } from "../../logger.js";
import { DOMAIN_STOPWORDS, NLQ_STOPWORD_PROMPT_HINT } from "../../constants/nlq.js";

const ALLOWED_OPERATORS: LogFilter["operator"][] = ["eq", "neq", "gt", "lt", "contains"];
type FacetHints = Partial<Record<"service" | "host" | "level", string[]>>;
type FormContext = LogQueryContext;
const TERM_VARIANTS: Record<string, string[]> = {
  fail: ["failed", "failure", "failures", "failing"],
  failed: ["fail", "failure", "failures", "failing"],
  failure: ["fail", "failed", "failures", "failing"],
  failures: ["fail", "failed", "failure", "failing"],
  failing: ["fail", "failed", "failure", "failures"],
};

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

  async translateQuery(
    naturalQuery: string,
    teamId: string,
    options?: { facetHints?: FacetHints; formContext?: FormContext },
  ): Promise<NLQTranslation> {
    if (this.useLLM && this.openai) {
      try {
        return await this.translateQueryWithLLM(naturalQuery, teamId, options);
      } catch (error) {
        logger.error({ error }, "LLM translation failed, falling back to heuristic");
        return this.translateQueryHeuristicPublic(naturalQuery, teamId);
      }
    }

    // Fallback to heuristic if no LLM available
    return this.translateQueryHeuristicPublic(naturalQuery, teamId);
  }

  private async translateQueryWithLLM(
    naturalQuery: string,
    teamId: string,
    options?: { facetHints?: FacetHints; formContext?: FormContext },
  ): Promise<NLQTranslation> {
    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
    const facetHints = options?.facetHints ?? {};
    const facetHintText = [
      `Known services in current scope: ${this.formatFacetHintValues(facetHints.service)}`,
      `Known hosts in current scope: ${this.formatFacetHintValues(facetHints.host)}`,
      `Known levels in current scope: ${this.formatFacetHintValues(facetHints.level)}`,
    ].join("\n");

    let contextSection = "";
    if (options?.formContext) {
      const ctx = options.formContext;
      contextSection = `\nCurrent UI state (override if the query implies different values):`;
      if (ctx.currentTimeRange) {
        contextSection += `\n  Time range: ${ctx.currentRelativeDuration ?? "custom"} (${ctx.currentTimeRange.startTime} to ${ctx.currentTimeRange.endTime})`;
      }
      if (ctx.currentFilters) {
        const active = Object.entries(ctx.currentFilters).filter(([, v]) => v);
        if (active.length > 0) {
          contextSection += `\n  Active filters: ${active.map(([k, v]) => `${k}=${v}`).join(", ")}`;
        }
      }
    }

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
- If a candidate service/host/level is not present in known facet values, do not emit that filter. Put that intent into textTerms instead.
- inferredTimeRange is optional. If user asks "last hour", use startTime="${oneHourAgo}" and endTime="${now.toISOString()}".
- If uncertain, add a warning and leave ambiguous items in textTerms.
Known facet values (ground truth from current search scope):
${facetHintText}${contextSection}
${NLQ_STOPWORD_PROMPT_HINT}`;

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
        ? parsed.textTerms
            .flatMap((term: string) => (typeof term === "string" ? term.split(/\s+/) : []))
            .map((t: string) => t.trim())
            .filter((t: string) => t.length > 1)
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
      ...DOMAIN_STOPWORDS,
      // Heuristic-specific extras (temporal + structural)
      "from",
      "last",
      "hour",
      "hours",
      "service",
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

  private formatFacetHintValues(values: string[] | undefined): string {
    if (!values || values.length === 0) {
      return "(none)";
    }
    return values.slice(0, 20).join(", ");
  }

  private expandTextTerms(terms: string[]): string[] {
    const normalized = terms
      .map((term) => term.toLowerCase().replace(/[^a-z0-9_-]/g, ""))
      .filter((term) => term.length > 1);
    const expanded = new Set<string>();
    for (const term of normalized) {
      expanded.add(term);
      if (TERM_VARIANTS[term]) {
        for (const variant of TERM_VARIANTS[term]) expanded.add(variant);
      }
      if (term.endsWith("s") && term.length > 4) expanded.add(term.slice(0, -1));
      if (term.endsWith("ed") && term.length > 4) expanded.add(term.slice(0, -2));
    }
    return [...expanded];
  }
}
