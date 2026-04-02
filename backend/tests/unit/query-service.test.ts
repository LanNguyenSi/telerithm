import { beforeEach, describe, expect, it, vi } from "vitest";

const translateQueryMock = vi.fn();
const searchMock = vi.fn();
const getFacetsMock = vi.fn();
const { nlqFilterPrunedTotalIncMock, nlqRelaxedFallbackUsedTotalIncMock } = vi.hoisted(() => ({
  nlqFilterPrunedTotalIncMock: vi.fn(),
  nlqRelaxedFallbackUsedTotalIncMock: vi.fn(),
}));

vi.mock("../../src/config/index.js", () => ({
  config: {
    maxSyncRuntimeMs: 1500,
  },
}));

vi.mock("../../src/services/ai/ai-service.js", () => ({
  AIService: vi.fn().mockImplementation(() => ({
    translateQuery: translateQueryMock,
  })),
}));

vi.mock("../../src/repositories/log-repository.js", () => ({
  LogRepository: vi.fn().mockImplementation(() => ({
    search: searchMock,
    getFacets: getFacetsMock,
  })),
}));

vi.mock("../../src/services/alert/alert-service.js", () => ({
  AlertService: vi.fn().mockImplementation(() => ({
    listIncidents: vi.fn(),
  })),
}));

vi.mock("../../src/cache/cache-service.js", () => ({
  cache: {
    get: vi.fn(),
    set: vi.fn(),
  },
}));

vi.mock("../../src/metrics/index.js", () => ({
  nlqFilterPrunedTotal: { inc: nlqFilterPrunedTotalIncMock },
  nlqRelaxedFallbackUsedTotal: { inc: nlqRelaxedFallbackUsedTotalIncMock },
}));

import { QueryService } from "../../src/services/query/query-service.js";

function makeSearchResult(overrides: Record<string, unknown> = {}) {
  return {
    logs: [],
    total: 0,
    requestId: "",
    partial: false,
    query: "",
    executionTimeMs: 1,
    cached: false,
    ...overrides,
  };
}

describe("QueryService — natural search mode", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getFacetsMock.mockResolvedValue({
      facets: [
        { field: "service", buckets: [{ value: "payment-service", count: 10 }] },
        { field: "host", buckets: [{ value: "play.telerithm.cloud", count: 10 }] },
        { field: "level", buckets: [{ value: "error", count: 10 }] },
      ],
    });
  });

  it("uses only AI-generated filters — user-provided filters are ignored", async () => {
    translateQueryMock.mockResolvedValue({
      explanation: "test",
      filtersApplied: [{ field: "service", operator: "contains", value: "payment" }],
      textTerms: ["payment", "failures"],
      warnings: [],
    });
    searchMock.mockResolvedValueOnce(makeSearchResult({ total: 5, logs: [{ id: "1" }] }));

    const service = new QueryService();
    const result = await service.search({
      teamId: "t1",
      queryType: "natural",
      query: "show me payment failures",
      // User-provided filters — should be ignored in natural mode
      filters: [
        { field: "message", operator: "eq", value: "payment failure" },
        { field: "host", operator: "eq", value: "api-1" },
      ],
    });

    expect(result.total).toBe(5);
    expect(searchMock).toHaveBeenCalledTimes(1);

    const plannedQuery = searchMock.mock.calls[0]?.[0];
    // Only AI filter should be present
    expect(plannedQuery.filters).toEqual([{ field: "service", operator: "contains", value: "payment" }]);
    // User message filter and host filter must NOT be forwarded
    expect(plannedQuery.filters).not.toEqual(
      expect.arrayContaining([{ field: "message", operator: "eq", value: "payment failure" }]),
    );
    expect(plannedQuery.filters).not.toEqual(
      expect.arrayContaining([{ field: "host", operator: "eq", value: "api-1" }]),
    );
  });

  it("relaxed fallback: retries with empty filters when AI filters produce 0 results", async () => {
    translateQueryMock.mockResolvedValue({
      explanation: "test",
      filtersApplied: [{ field: "service", operator: "contains", value: "payment" }],
      textTerms: ["payment", "failures"],
      warnings: [],
    });
    searchMock
      .mockResolvedValueOnce(makeSearchResult({ total: 0 })) // first: AI filters → 0
      .mockResolvedValueOnce(makeSearchResult({ total: 10, logs: [{ id: "1" }] })); // retry: no filters → 10

    const service = new QueryService();
    const result = await service.search({
      teamId: "t1",
      queryType: "natural",
      query: "show me payment failures",
    });

    expect(result.total).toBe(10);
    expect(searchMock).toHaveBeenCalledTimes(2);

    const retryQuery = searchMock.mock.calls[1]?.[0];
    expect(retryQuery.filters).toEqual([]);
    expect(nlqRelaxedFallbackUsedTotalIncMock).toHaveBeenCalledWith({ result: "triggered" });
    expect(nlqRelaxedFallbackUsedTotalIncMock).toHaveBeenCalledWith({ result: "recovered" });
  });

  it("domain stopwords are stripped from AI textTerms", async () => {
    translateQueryMock.mockResolvedValue({
      explanation: "test",
      filtersApplied: [],
      textTerms: ["logs", "payment", "show", "me"],
      warnings: [],
    });
    searchMock.mockResolvedValueOnce(makeSearchResult({ total: 1, logs: [{ id: "1" }] }));

    const service = new QueryService();
    await service.search({
      teamId: "t1",
      queryType: "natural",
      query: "show payment logs",
    });

    const plannedQuery = searchMock.mock.calls[0]?.[0];
    expect(plannedQuery.query).toContain("payment");
    // Domain stopwords must be stripped — check as standalone words (split on spaces)
    const queryTokens = (plannedQuery.query as string).split(/\s+/);
    expect(queryTokens).not.toContain("logs");
    expect(queryTokens).not.toContain("show");
    expect(queryTokens).not.toContain("me");
  });

  it("AI inferred time range overrides form context time range", async () => {
    const aiStart = "2026-04-02T13:00:00.000Z";
    const aiEnd = "2026-04-02T14:00:00.000Z";

    translateQueryMock.mockResolvedValue({
      explanation: "test",
      filtersApplied: [],
      textTerms: ["errors"],
      inferredTimeRange: { startTime: aiStart, endTime: aiEnd },
      warnings: [],
    });
    searchMock.mockResolvedValueOnce(makeSearchResult({ total: 3, logs: [{ id: "1" }] }));

    const service = new QueryService();
    await service.search({
      teamId: "t1",
      queryType: "natural",
      query: "show me errors from the last hour",
      context: {
        currentTimeRange: {
          startTime: "2026-03-26T00:00:00.000Z",
          endTime: "2026-04-02T00:00:00.000Z",
        },
        currentRelativeDuration: "7d",
      },
    });

    const plannedQuery = searchMock.mock.calls[0]?.[0];
    expect(plannedQuery.startTime).toBe(aiStart);
    expect(plannedQuery.endTime).toBe(aiEnd);
  });

  it("form context time range is used as fallback when AI does not infer a time range", async () => {
    const ctxStart = "2026-04-02T00:00:00.000Z";
    const ctxEnd = "2026-04-02T23:59:59.000Z";

    translateQueryMock.mockResolvedValue({
      explanation: "test",
      filtersApplied: [],
      textTerms: ["payment"],
      // No inferredTimeRange
      warnings: [],
    });
    searchMock.mockResolvedValueOnce(makeSearchResult({ total: 2 }));

    const service = new QueryService();
    await service.search({
      teamId: "t1",
      queryType: "natural",
      query: "payment errors",
      context: {
        currentTimeRange: { startTime: ctxStart, endTime: ctxEnd },
      },
    });

    const plannedQuery = searchMock.mock.calls[0]?.[0];
    expect(plannedQuery.startTime).toBe(ctxStart);
    expect(plannedQuery.endTime).toBe(ctxEnd);
  });

  it("passes form context to AI service", async () => {
    translateQueryMock.mockResolvedValue({
      explanation: "test",
      filtersApplied: [],
      textTerms: [],
      warnings: [],
    });
    searchMock.mockResolvedValueOnce(makeSearchResult());

    const service = new QueryService();
    await service.search({
      teamId: "t1",
      queryType: "natural",
      query: "payment errors",
      context: {
        currentTimeRange: { startTime: "2026-04-02T00:00:00Z", endTime: "2026-04-02T23:59:59Z" },
        currentFilters: { level: "error" },
        currentRelativeDuration: "24h",
      },
    });

    expect(translateQueryMock).toHaveBeenCalledWith(
      "payment errors",
      "t1",
      expect.objectContaining({
        formContext: expect.objectContaining({
          currentFilters: { level: "error" },
          currentRelativeDuration: "24h",
        }),
      }),
    );
  });

  it("message filters from AI are pruned and not sent to repo", async () => {
    translateQueryMock.mockResolvedValue({
      explanation: "test",
      filtersApplied: [{ field: "message", operator: "contains", value: "payment" }],
      textTerms: ["payment"],
      warnings: [],
    });
    searchMock.mockResolvedValueOnce(makeSearchResult({ total: 1 }));

    const service = new QueryService();
    await service.search({
      teamId: "t1",
      queryType: "natural",
      query: "show payment errors",
    });

    const plannedQuery = searchMock.mock.calls[0]?.[0];
    expect(plannedQuery.filters).not.toEqual(
      expect.arrayContaining([{ field: "message", operator: "contains", value: "payment" }]),
    );
    expect(nlqFilterPrunedTotalIncMock).toHaveBeenCalledWith({ field: "message", reason: "redundant" });
  });
});

describe("QueryService — manual search mode", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("passes filters directly to repository without AI involvement", async () => {
    searchMock.mockResolvedValueOnce(makeSearchResult({ total: 7, logs: [{ id: "1" }] }));

    const service = new QueryService();
    const result = await service.search({
      teamId: "t1",
      queryType: "sql",
      filters: [
        { field: "level", operator: "eq", value: "error" },
        { field: "service", operator: "contains", value: "api-gateway" },
      ],
      startTime: "2026-04-02T00:00:00Z",
      endTime: "2026-04-02T23:59:59Z",
    });

    expect(result.total).toBe(7);
    expect(translateQueryMock).not.toHaveBeenCalled();
    expect(searchMock).toHaveBeenCalledTimes(1);

    const passedQuery = searchMock.mock.calls[0]?.[0];
    expect(passedQuery.filters).toEqual([
      { field: "level", operator: "eq", value: "error" },
      { field: "service", operator: "contains", value: "api-gateway" },
    ]);
    expect(passedQuery.startTime).toBe("2026-04-02T00:00:00Z");
    expect(passedQuery.endTime).toBe("2026-04-02T23:59:59Z");
  });

  it("does not call AI for manual queries without NL query text", async () => {
    searchMock.mockResolvedValueOnce(makeSearchResult({ total: 3 }));

    const service = new QueryService();
    await service.search({
      teamId: "t1",
      queryType: "sql",
    });

    expect(translateQueryMock).not.toHaveBeenCalled();
    expect(getFacetsMock).not.toHaveBeenCalled();
  });
});

describe("QueryService — validateGeneratedFilters (via natural search)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getFacetsMock.mockResolvedValue({ facets: [] });
  });

  it("keeps numeric filter values as-is (no string trimming)", async () => {
    translateQueryMock.mockResolvedValue({
      explanation: "test",
      filtersApplied: [{ field: "status_code", operator: "eq", value: 500 }],
      textTerms: [],
      warnings: [],
    });
    searchMock.mockResolvedValueOnce(makeSearchResult({ total: 1 }));
    const service = new QueryService();
    await service.search({ teamId: "t1", queryType: "natural", query: "500 errors" });
    const q = searchMock.mock.calls[0]?.[0];
    expect(q.filters).toEqual([{ field: "status_code", operator: "eq", value: 500 }]);
  });

  it("prunes filter with empty string value", async () => {
    translateQueryMock.mockResolvedValue({
      explanation: "test",
      filtersApplied: [{ field: "service", operator: "eq", value: "   " }],
      textTerms: [],
      warnings: [],
    });
    searchMock.mockResolvedValueOnce(makeSearchResult({ total: 0 }));
    const service = new QueryService();
    await service.search({ teamId: "t1", queryType: "natural", query: "errors" });
    expect(nlqFilterPrunedTotalIncMock).toHaveBeenCalledWith({ field: "service", reason: "empty" });
  });

  it("keeps service filter when facet hints are empty", async () => {
    translateQueryMock.mockResolvedValue({
      explanation: "test",
      filtersApplied: [{ field: "service", operator: "eq", value: "payment" }],
      textTerms: [],
      warnings: [],
    });
    searchMock.mockResolvedValueOnce(makeSearchResult({ total: 1 }));
    const service = new QueryService();
    await service.search({ teamId: "t1", queryType: "natural", query: "payment errors" });
    const q = searchMock.mock.calls[0]?.[0];
    expect(q.filters).toContainEqual(expect.objectContaining({ field: "service", value: "payment" }));
  });

  it("prunes service filter when value not in known facets", async () => {
    getFacetsMock.mockResolvedValue({
      facets: [{ field: "service", buckets: [{ value: "api-gateway", count: 5 }] }],
    });
    translateQueryMock.mockResolvedValue({
      explanation: "test",
      filtersApplied: [{ field: "service", operator: "eq", value: "nonexistent-service" }],
      textTerms: [],
      warnings: [],
    });
    searchMock.mockResolvedValueOnce(makeSearchResult({ total: 0 }));
    const service = new QueryService();
    await service.search({ teamId: "t1", queryType: "natural", query: "errors" });
    expect(nlqFilterPrunedTotalIncMock).toHaveBeenCalledWith({ field: "service", reason: "unknown_value" });
  });

  it("normalizes service filter operator from eq to contains", async () => {
    getFacetsMock.mockResolvedValue({
      facets: [{ field: "service", buckets: [{ value: "payment-service", count: 5 }] }],
    });
    translateQueryMock.mockResolvedValue({
      explanation: "test",
      filtersApplied: [{ field: "service", operator: "eq", value: "payment" }],
      textTerms: [],
      warnings: [],
    });
    searchMock.mockResolvedValueOnce(makeSearchResult({ total: 1 }));
    const service = new QueryService();
    await service.search({ teamId: "t1", queryType: "natural", query: "payment errors" });
    const q = searchMock.mock.calls[0]?.[0];
    expect(q.filters).toContainEqual({ field: "service", operator: "contains", value: "payment" });
  });

  it("keeps host filter with contains operator when value matches", async () => {
    getFacetsMock.mockResolvedValue({
      facets: [{ field: "host", buckets: [{ value: "api-host-1", count: 3 }] }],
    });
    translateQueryMock.mockResolvedValue({
      explanation: "test",
      filtersApplied: [{ field: "host", operator: "contains", value: "api" }],
      textTerms: [],
      warnings: [],
    });
    searchMock.mockResolvedValueOnce(makeSearchResult({ total: 2 }));
    const service = new QueryService();
    await service.search({ teamId: "t1", queryType: "natural", query: "api host errors" });
    const q = searchMock.mock.calls[0]?.[0];
    expect(q.filters).toContainEqual({ field: "host", operator: "contains", value: "api" });
  });

  it("prunes host filter with eq operator when value not in known hosts", async () => {
    getFacetsMock.mockResolvedValue({
      facets: [{ field: "host", buckets: [{ value: "api-host-1", count: 3 }] }],
    });
    translateQueryMock.mockResolvedValue({
      explanation: "test",
      filtersApplied: [{ field: "host", operator: "eq", value: "unknown-host" }],
      textTerms: [],
      warnings: [],
    });
    searchMock.mockResolvedValueOnce(makeSearchResult({ total: 0 }));
    const service = new QueryService();
    await service.search({ teamId: "t1", queryType: "natural", query: "unknown host" });
    expect(nlqFilterPrunedTotalIncMock).toHaveBeenCalledWith({ field: "host", reason: "unknown_value" });
  });

  it("prunes level filter when value not in known levels", async () => {
    getFacetsMock.mockResolvedValue({
      facets: [{ field: "level", buckets: [{ value: "error", count: 10 }] }],
    });
    translateQueryMock.mockResolvedValue({
      explanation: "test",
      filtersApplied: [{ field: "level", operator: "eq", value: "critical" }],
      textTerms: [],
      warnings: [],
    });
    searchMock.mockResolvedValueOnce(makeSearchResult({ total: 0 }));
    const service = new QueryService();
    await service.search({ teamId: "t1", queryType: "natural", query: "critical errors" });
    expect(nlqFilterPrunedTotalIncMock).toHaveBeenCalledWith({ field: "level", reason: "unknown_value" });
  });

  it("keeps unknown field filters (pass-through for custom fields)", async () => {
    translateQueryMock.mockResolvedValue({
      explanation: "test",
      filtersApplied: [{ field: "env", operator: "eq", value: "production" }],
      textTerms: [],
      warnings: [],
    });
    searchMock.mockResolvedValueOnce(makeSearchResult({ total: 5 }));
    const service = new QueryService();
    await service.search({ teamId: "t1", queryType: "natural", query: "production errors" });
    const q = searchMock.mock.calls[0]?.[0];
    expect(q.filters).toContainEqual({ field: "env", operator: "eq", value: "production" });
  });

  it("deduplicates textTerms already covered by AI filter values", async () => {
    getFacetsMock.mockResolvedValue({
      facets: [{ field: "level", buckets: [{ value: "error", count: 10 }] }],
    });
    translateQueryMock.mockResolvedValue({
      explanation: "test",
      filtersApplied: [{ field: "level", operator: "eq", value: "error" }],
      textTerms: ["error", "payment"],
      warnings: [],
    });
    searchMock.mockResolvedValueOnce(makeSearchResult({ total: 5 }));
    const service = new QueryService();
    await service.search({ teamId: "t1", queryType: "natural", query: "payment errors" });
    const q = searchMock.mock.calls[0]?.[0];
    const queryTerms = (q.query as string | undefined)?.split(/\s+/) ?? [];
    expect(queryTerms).not.toContain("error");
    expect(queryTerms).toContain("payment");
  });

  it("sets query to undefined when all textTerms covered by filter values", async () => {
    getFacetsMock.mockResolvedValue({
      facets: [{ field: "service", buckets: [{ value: "payment-service", count: 5 }] }],
    });
    translateQueryMock.mockResolvedValue({
      explanation: "test",
      filtersApplied: [{ field: "service", operator: "contains", value: "payment" }],
      textTerms: ["payment"],
      warnings: [],
    });
    searchMock.mockResolvedValueOnce(makeSearchResult({ total: 3 }));
    const service = new QueryService();
    await service.search({ teamId: "t1", queryType: "natural", query: "payment service" });
    const q = searchMock.mock.calls[0]?.[0];
    expect(q.query).toBeUndefined();
  });
});

describe("QueryService — async jobs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("startAsyncJob returns requestId immediately", () => {
    const service = new QueryService();
    const result = service.startAsyncJob(() => Promise.resolve({ data: "test" }));
    expect(result.requestId).toBeTruthy();
    expect(result.partial).toBe(true);
    expect(result.cached).toBe(false);
  });

  it("getAsyncJob returns null for unknown requestId", () => {
    const service = new QueryService();
    expect(service.getAsyncJob("non-existent-id")).toBeNull();
  });

  it("getAsyncJob returns pending status right after start", () => {
    const service = new QueryService();
    const { requestId } = service.startAsyncJob(() => new Promise(() => {}));
    const job = service.getAsyncJob(requestId);
    expect(job).not.toBeNull();
    expect(job!.status).toBe("pending");
    expect(job!.requestId).toBe(requestId);
  });

  it("getAsyncJob returns completed status after resolution", async () => {
    const service = new QueryService();
    const { requestId } = service.startAsyncJob(() => Promise.resolve({ data: "result" }));
    await new Promise((resolve) => setTimeout(resolve, 10));
    const job = service.getAsyncJob(requestId);
    expect(job!.status).toBe("completed");
    expect(job!.data).toEqual({ data: "result" });
  });

  it("getAsyncJob returns failed status after rejection", async () => {
    const service = new QueryService();
    const { requestId } = service.startAsyncJob(() => Promise.reject(new Error("job failed")));
    await new Promise((resolve) => setTimeout(resolve, 10));
    const job = service.getAsyncJob(requestId);
    expect(job!.status).toBe("failed");
    expect(job!.error).toBe("job failed");
  });

  it("getMaxSyncRuntimeMs returns config value", () => {
    const service = new QueryService();
    expect(service.getMaxSyncRuntimeMs()).toBe(1500);
  });
});

describe("QueryService — delegate methods", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getFacetsMock.mockResolvedValue({ facets: [] });
  });

  it("getFacets delegates to logRepo", async () => {
    getFacetsMock.mockResolvedValue({ facets: [{ field: "level", buckets: [] }] });
    const service = new QueryService();
    const query = { teamId: "t1", queryType: "sql" as const, fields: ["level" as const], limit: 10 };
    const result = await service.getFacets(query);
    expect(getFacetsMock).toHaveBeenCalledWith(query);
    expect(result.facets).toHaveLength(1);
  });
});

describe("QueryService — natural search: relaxed fallback edge cases", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getFacetsMock.mockResolvedValue({ facets: [] });
  });

  it("still_zero metric fired when relaxed retry also returns 0", async () => {
    translateQueryMock.mockResolvedValue({
      explanation: "test",
      filtersApplied: [{ field: "service", operator: "contains", value: "payment" }],
      textTerms: [],
      warnings: [],
    });
    searchMock
      .mockResolvedValueOnce(makeSearchResult({ total: 0 }))
      .mockResolvedValueOnce(makeSearchResult({ total: 0 }));
    const service = new QueryService();
    const result = await service.search({ teamId: "t1", queryType: "natural", query: "payment" });
    expect(result.total).toBe(0);
    expect(nlqRelaxedFallbackUsedTotalIncMock).toHaveBeenCalledWith({ result: "still_zero" });
  });

  it("no relaxed fallback when AI returns no filters", async () => {
    translateQueryMock.mockResolvedValue({
      explanation: "test",
      filtersApplied: [],
      textTerms: ["payment"],
      warnings: [],
    });
    searchMock.mockResolvedValueOnce(makeSearchResult({ total: 0 }));
    const service = new QueryService();
    await service.search({ teamId: "t1", queryType: "natural", query: "payment" });
    expect(searchMock).toHaveBeenCalledTimes(1);
    expect(nlqRelaxedFallbackUsedTotalIncMock).not.toHaveBeenCalled();
  });

  it("query is undefined when AI returns no textTerms", async () => {
    translateQueryMock.mockResolvedValue({
      explanation: "test",
      filtersApplied: [],
      textTerms: undefined,
      warnings: [],
    });
    searchMock.mockResolvedValueOnce(makeSearchResult({ total: 0 }));
    const service = new QueryService();
    await service.search({ teamId: "t1", queryType: "natural", query: "errors" });
    const q = searchMock.mock.calls[0]?.[0];
    expect(q.query).toBeUndefined();
  });
});
