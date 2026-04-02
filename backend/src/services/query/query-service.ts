import { randomUUID } from "node:crypto";
import type {
  DashboardSummary,
  LogFilter,
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
import { nlqFilterPrunedTotal, nlqRelaxedFallbackUsedTotal } from "../../metrics/index.js";

const DASHBOARD_CACHE_TTL = 30; // seconds

type AsyncStatus = "pending" | "completed" | "failed";
type FacetHints = Partial<Record<"service" | "host" | "level", Set<string>>>;
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
      const facetHints = await this.loadFacetHints(query);
      const translation = await this.aiService.translateQuery(originalQuery, query.teamId, {
        facetHints: this.facetHintsToArrays(facetHints),
      });
      const validated = this.validateGeneratedFilters(translation.filtersApplied, facetHints);
      const validatedAiFilters = validated.filters;
      for (const pruned of validated.pruned) {
        nlqFilterPrunedTotal.inc({ field: pruned.field, reason: pruned.reason });
      }

      const userFilters = query.filters ?? [];
      const mergedFilters = [...userFilters, ...validatedAiFilters].filter(
        (filter, index, allFilters) =>
          allFilters.findIndex(
            (candidate) =>
              candidate.field === filter.field &&
              candidate.operator === filter.operator &&
              String(candidate.value) === String(filter.value),
          ) === index,
      );
      // Remove textTerms already covered by filters to avoid redundant AND conditions
      const filterValues = new Set(
        [...(query.filters ?? []), ...validatedAiFilters]
          .map((f) => String(f.value).toLowerCase())
          .flatMap((v) => v.split(/\s+/)),
      );
      const textTerms = (translation.textTerms ?? [])
        .filter((term) => !filterValues.has(term.toLowerCase()))
        .join(" ")
        .trim();
      const inferredStart = translation.inferredTimeRange?.startTime;
      const inferredEnd = translation.inferredTimeRange?.endTime;

      const plannedQuery: LogQuery = {
        ...query,
        filters: mergedFilters,
        startTime: query.startTime ?? inferredStart,
        endTime: query.endTime ?? inferredEnd,
        queryType: "sql",
        query: textTerms.length > 0 ? textTerms : query.query,
      };

      const plannedResult = await this.logRepo.search(plannedQuery);
      if (plannedResult.total === 0 && validatedAiFilters.length > 0) {
        nlqRelaxedFallbackUsedTotal.inc({ result: "triggered" });
        const relaxedResult = await this.logRepo.search({
          ...plannedQuery,
          filters: userFilters,
        });
        if (relaxedResult.total > 0) {
          nlqRelaxedFallbackUsedTotal.inc({ result: "recovered" });
          return { ...relaxedResult, requestId };
        }
        nlqRelaxedFallbackUsedTotal.inc({ result: "still_zero" });
      }
      return { ...plannedResult, requestId };
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

  private async loadFacetHints(query: LogQuery): Promise<FacetHints> {
    const facetQuery: LogFacetQuery = {
      teamId: query.teamId,
      sourceId: query.sourceId,
      startTime: query.startTime,
      endTime: query.endTime,
      queryType: "sql",
      filters: query.filters,
      fields: ["service", "host", "level"],
      limit: 100,
    };
    const facets = await this.logRepo.getFacets(facetQuery);
    const hints: FacetHints = {};
    for (const facet of facets.facets) {
      if (facet.field !== "service" && facet.field !== "host" && facet.field !== "level") continue;
      hints[facet.field] = new Set(
        facet.buckets.map((bucket) => bucket.value.trim().toLowerCase()).filter((value) => value.length > 0),
      );
    }
    return hints;
  }

  private facetHintsToArrays(hints: FacetHints): Partial<Record<"service" | "host" | "level", string[]>> {
    return {
      service: hints.service ? [...hints.service] : undefined,
      host: hints.host ? [...hints.host] : undefined,
      level: hints.level ? [...hints.level] : undefined,
    };
  }

  private validateGeneratedFilters(
    filters: LogFilter[],
    facetHints: FacetHints,
  ): {
    filters: LogFilter[];
    pruned: Array<{ field: string; reason: "empty" | "unknown_value" | "redundant" }>;
  } {
    const kept: LogFilter[] = [];
    const pruned: Array<{ field: string; reason: "empty" | "unknown_value" | "redundant" }> = [];

    for (const filter of filters) {
      if (typeof filter.value !== "string") {
        kept.push(filter);
        continue;
      }

      const value = filter.value.trim().toLowerCase();
      if (value.length === 0) {
        pruned.push({ field: filter.field, reason: "empty" });
        continue;
      }

      if (filter.field === "service") {
        const knownServices = facetHints.service;
        if (!knownServices || knownServices.size === 0) {
          kept.push(filter);
          continue;
        }
        const operator = filter.operator === "eq" ? "contains" : filter.operator;
        if ([...knownServices].some((service) => service.includes(value))) {
          kept.push({ ...filter, operator });
        } else {
          pruned.push({ field: filter.field, reason: "unknown_value" });
        }
        continue;
      }

      if (filter.field === "host") {
        const knownHosts = facetHints.host;
        if (!knownHosts || knownHosts.size === 0) {
          kept.push(filter);
          continue;
        }
        const isValid =
          filter.operator === "contains"
            ? [...knownHosts].some((host) => host.includes(value))
            : knownHosts.has(value);
        if (isValid) {
          kept.push(filter);
        } else {
          pruned.push({ field: filter.field, reason: "unknown_value" });
        }
        continue;
      }

      if (filter.field === "level") {
        const knownLevels = facetHints.level;
        if (!knownLevels || knownLevels.size === 0 || knownLevels.has(value)) {
          kept.push(filter);
        } else {
          pruned.push({ field: filter.field, reason: "unknown_value" });
        }
        continue;
      }

      // Message filters are redundant with textTerms search — drop them to avoid over-filtering
      if (filter.field === "message") {
        pruned.push({ field: filter.field, reason: "redundant" });
        continue;
      }
      kept.push(filter);
    }

    return { filters: kept, pruned };
  }
}
