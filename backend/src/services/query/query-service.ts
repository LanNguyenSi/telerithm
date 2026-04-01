import type {
  DashboardSummary,
  LogFacetQuery,
  LogFacetResult,
  LogHistogramQuery,
  LogHistogramResult,
  LogPatternsQuery,
  LogPatternsResult,
  LogQuery,
  LogSearchResult,
} from "../../types/domain.js";
import { LogRepository } from "../../repositories/log-repository.js";
import { AIService } from "../ai/ai-service.js";
import { AlertService } from "../alert/alert-service.js";
import { cache } from "../../cache/cache-service.js";

const DASHBOARD_CACHE_TTL = 30; // seconds

export class QueryService {
  private readonly aiService = new AIService();
  private readonly logRepo = new LogRepository();
  private readonly alertService = new AlertService();

  async search(query: LogQuery): Promise<LogSearchResult> {
    if (query.queryType === "natural" && query.query) {
      const originalQuery = query.query;
      const translation = await this.aiService.translateQuery(originalQuery, query.teamId);

      // Normalize LIKE to ILIKE + lowercase level values for case-insensitive matching
      const normalizedSql = translation.sql
        ? translation.sql
            .replace(/\bLIKE\b/gi, "ILIKE")
            .replace(/level\s*=\s*'([A-Z]+)'/g, (_, lvl) => `level = '${lvl.toLowerCase()}'`)
        : undefined;

      const llmQuery: LogQuery = {
        ...query,
        filters: [...(query.filters ?? []), ...translation.filtersApplied],
        queryType: "sql",
        query: normalizedSql,
      };

      const llmResult = await this.logRepo.search(llmQuery);

      if (llmResult.logs.length > 0) {
        return llmResult;
      }

      // Fallback: heuristic filters
      const heuristic = this.aiService.translateQueryHeuristicPublic(originalQuery, query.teamId);
      const fallbackQuery: LogQuery = {
        ...query,
        filters: [...(query.filters ?? []), ...heuristic.filtersApplied],
        queryType: "sql",
        query: undefined,
      };

      return this.logRepo.search(fallbackQuery);
    }

    return this.logRepo.search(query);
  }

  async explainNaturalQuery(teamId: string, naturalQuery: string) {
    return await this.aiService.translateQuery(naturalQuery, teamId);
  }

  async getContext(query: {
    teamId: string;
    sourceId: string;
    timestamp: string;
    before: number;
    after: number;
    scope: "source" | "service" | "host";
    service?: string;
    host?: string;
  }) {
    return this.logRepo.getContext(query);
  }

  async getFacets(query: LogFacetQuery): Promise<LogFacetResult> {
    return this.logRepo.getFacets(query);
  }

  async getHistogram(query: LogHistogramQuery): Promise<LogHistogramResult> {
    return this.logRepo.getHistogram(query);
  }

  async getPatterns(query: LogPatternsQuery): Promise<LogPatternsResult> {
    return this.logRepo.getPatterns(query);
  }

  async getDashboardSummary(teamId: string): Promise<DashboardSummary> {
    const cacheKey = `dashboard:overview:${teamId}`;
    const cached = await cache.get<DashboardSummary>(cacheKey);
    if (cached) {
      return cached;
    }

    const [stats, incidents] = await Promise.all([
      this.logRepo.getStats(teamId),
      this.alertService.listIncidents(teamId),
    ]);

    const summary: DashboardSummary = {
      teamId,
      totalLogs: stats.totalLogs,
      errorRate: stats.errorRate,
      services: stats.services,
      recentIncidents: incidents.slice(0, 5),
    };

    await cache.set(cacheKey, summary, DASHBOARD_CACHE_TTL);
    return summary;
  }
}
