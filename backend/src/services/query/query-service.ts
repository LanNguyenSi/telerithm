import type { DashboardSummary, LogQuery, LogSearchResult } from "../../types/domain.js";
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

      // Normalize LIKE to ILIKE for case-insensitive matching
      const normalizedSql = translation.sql
        ? translation.sql.replace(/\bLIKE\b/gi, "ILIKE")
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

      // Fallback: text search across message/service/host
      return this.logRepo.search({
        ...query,
        queryType: "sql",
        query: originalQuery,
      });
    }

    return this.logRepo.search(query);
  }

  async explainNaturalQuery(teamId: string, naturalQuery: string) {
    return await this.aiService.translateQuery(naturalQuery, teamId);
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
