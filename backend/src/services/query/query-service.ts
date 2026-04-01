import { randomUUID } from "node:crypto";
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
import { config } from "../../config/index.js";

const DASHBOARD_CACHE_TTL = 30; // seconds

type AsyncStatus = "pending" | "completed" | "failed";
type AsyncJobRecord = {
  requestId: string;
  status: AsyncStatus;
  createdAt: number;
  data?: unknown;
  error?: string;
};

const ASYNC_TTL_MS = 5 * 60 * 1000;

export class QueryService {
  private readonly aiService = new AIService();
  private readonly logRepo = new LogRepository();
  private readonly alertService = new AlertService();
  private readonly asyncJobs = new Map<string, AsyncJobRecord>();

  async search(query: LogQuery): Promise<LogSearchResult> {
    const requestId = randomUUID();
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
        return { ...llmResult, requestId };
      }

      // Fallback: heuristic filters
      const heuristic = this.aiService.translateQueryHeuristicPublic(originalQuery, query.teamId);
      const fallbackQuery: LogQuery = {
        ...query,
        filters: [...(query.filters ?? []), ...heuristic.filtersApplied],
        queryType: "sql",
        query: undefined,
      };

      const fallbackResult = await this.logRepo.search(fallbackQuery);
      return { ...fallbackResult, requestId };
    }

    const result = await this.logRepo.search(query);
    return { ...result, requestId };
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

  startAsyncJob<T>(producer: () => Promise<T>): { requestId: string; partial: true; cached: false } {
    this.cleanupAsyncJobs();
    const requestId = randomUUID();
    this.asyncJobs.set(requestId, {
      requestId,
      status: "pending",
      createdAt: Date.now(),
    });

    void producer()
      .then((data) => {
        this.asyncJobs.set(requestId, {
          requestId,
          status: "completed",
          createdAt: Date.now(),
          data,
        });
      })
      .catch((error) => {
        this.asyncJobs.set(requestId, {
          requestId,
          status: "failed",
          createdAt: Date.now(),
          error: error instanceof Error ? error.message : "Async job failed",
        });
      });

    return { requestId, partial: true, cached: false };
  }

  getAsyncJob(
    requestId: string,
  ): { requestId: string; status: AsyncStatus; data?: unknown; error?: string } | null {
    this.cleanupAsyncJobs();
    const job = this.asyncJobs.get(requestId);
    if (!job) return null;
    return {
      requestId: job.requestId,
      status: job.status,
      data: job.data,
      error: job.error,
    };
  }

  getMaxSyncRuntimeMs(): number {
    return config.maxSyncRuntimeMs;
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

  private cleanupAsyncJobs(): void {
    const cutoff = Date.now() - ASYNC_TTL_MS;
    for (const [id, job] of this.asyncJobs.entries()) {
      if (job.createdAt < cutoff) {
        this.asyncJobs.delete(id);
      }
    }
  }
}
