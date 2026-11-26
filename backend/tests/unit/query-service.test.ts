import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
    asyncJobsMaxInflightPerTeam: 10,
    asyncJobsMaxInflight: 100,
  },
}));

vi.mock("../../src/services/ai/ai-service.js", () => ({
  AIService: vi.fn().mockImplementation(function () {
    return {
      translateQuery: translateQueryMock,
    };
  }),
}));

vi.mock("../../src/repositories/log-repository.js", () => ({
  LogRepository: vi.fn().mockImplementation(function () {
    return {
      search: searchMock,
      getFacets: getFacetsMock,
    };
  }),
}));

vi.mock("../../src/services/alert/alert-service.js", () => ({
  AlertService: vi.fn().mockImplementation(function () {
    return {
      listIncidents: vi.fn(),
    };
  }),
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

import { config } from "../../src/config/index.js";
import { AsyncJobCapError, QueryService } from "../../src/services/query/query-service.js";

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

  it("labels a pruned source_id filter with the normalized field name, not _unknown", async () => {
    translateQueryMock.mockResolvedValue({
      explanation: "test",
      filtersApplied: [{ field: "source_id", operator: "eq", value: "   " }],
      textTerms: [],
      warnings: [],
    });
    searchMock.mockResolvedValueOnce(makeSearchResult({ total: 0 }));
    const service = new QueryService();
    await service.search({ teamId: "t1", queryType: "natural", query: "source errors" });
    expect(nlqFilterPrunedTotalIncMock).toHaveBeenCalledWith({ field: "source_id", reason: "empty" });
    expect(nlqFilterPrunedTotalIncMock).not.toHaveBeenCalledWith(
      expect.objectContaining({ field: "_unknown" }),
    );
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

const OWNER_TEAM = "t1";

describe("QueryService — async jobs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("startAsyncJob returns requestId immediately", () => {
    const service = new QueryService();
    const result = service.startAsyncJob(OWNER_TEAM, () => Promise.resolve({ data: "test" }));
    expect(result.requestId).toBeTruthy();
    expect(result.partial).toBe(true);
    expect(result.cached).toBe(false);
  });

  it("getAsyncJob returns null for unknown requestId", () => {
    const service = new QueryService();
    expect(service.getAsyncJob("non-existent-id")).toBeNull();
  });

  it("carries the owning teamId on the job so the route can authorize it (9d86d755)", () => {
    const service = new QueryService();
    const { requestId } = service.startAsyncJob("team-owner", () => new Promise(() => {}));

    expect(service.getAsyncJob(requestId)!.teamId).toBe("team-owner");
  });

  it("keeps the teamId across the completed and failed transitions", async () => {
    const service = new QueryService();
    const ok = service.startAsyncJob("team-a", () =>
      Promise.resolve({ data: "result" }),
    );
    const bad = service.startAsyncJob("team-b", () =>
      Promise.reject(new Error("boom")),
    );
    await new Promise((resolve) => setTimeout(resolve, 10));

    // The teamId must survive the record rewrite in .then/.catch, otherwise the
    // route would lose its authorization anchor exactly when data exists.
    expect(service.getAsyncJob(ok.requestId)!.status).toBe("completed");
    expect(service.getAsyncJob(ok.requestId)!.teamId).toBe("team-a");
    expect(service.getAsyncJob(bad.requestId)!.status).toBe("failed");
    expect(service.getAsyncJob(bad.requestId)!.teamId).toBe("team-b");
  });

  it("getAsyncJob returns pending status right after start", () => {
    const service = new QueryService();
    const { requestId } = service.startAsyncJob(OWNER_TEAM, () => new Promise(() => {}));
    const job = service.getAsyncJob(requestId);
    expect(job).not.toBeNull();
    expect(job!.status).toBe("pending");
    expect(job!.requestId).toBe(requestId);
  });

  it("getAsyncJob returns completed status after resolution", async () => {
    const service = new QueryService();
    const { requestId } = service.startAsyncJob(OWNER_TEAM, () => Promise.resolve({ data: "result" }));
    await new Promise((resolve) => setTimeout(resolve, 10));
    const job = service.getAsyncJob(requestId);
    expect(job!.status).toBe("completed");
    expect(job!.data).toEqual({ data: "result" });
  });

  it("getAsyncJob returns failed status after rejection", async () => {
    const service = new QueryService();
    const { requestId } = service.startAsyncJob(OWNER_TEAM, () => Promise.reject(new Error("job failed")));
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

type Deferred<T> = { promise: Promise<T>; resolve: (value: T) => void; reject: (error: Error) => void };

function deferred<T = unknown>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

// Lets the .then/.catch of a settled producer rewrite its job record.
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("QueryService async job cap", () => {
  const caps = config as { asyncJobsMaxInflightPerTeam: number; asyncJobsMaxInflight: number };

  function setCaps(perTeam: number, process: number) {
    caps.asyncJobsMaxInflightPerTeam = perTeam;
    caps.asyncJobsMaxInflight = process;
  }

  // A producer that never settles unless the test settles it; calls are spied.
  function pending() {
    const d = deferred();
    const producer = vi.fn(() => d.promise);
    return { d, producer };
  }

  function refusal(fn: () => unknown): AsyncJobCapError {
    try {
      fn();
    } catch (error) {
      expect(error).toBeInstanceOf(AsyncJobCapError);
      return error as AsyncJobCapError;
    }
    throw new Error("expected startAsyncJob to refuse");
  }

  beforeEach(() => {
    vi.clearAllMocks();
    setCaps(10, 100);
  });

  afterEach(() => {
    setCaps(10, 100);
    vi.useRealTimers();
  });

  it("starts jobs up to the per-team limit and refuses the next one without calling its producer", () => {
    setCaps(2, 100);
    const service = new QueryService();
    const first = pending();
    const second = pending();
    const third = pending();
    service.startAsyncJob("t1", first.producer);
    service.startAsyncJob("t1", second.producer);

    const error = refusal(() => service.startAsyncJob("t1", third.producer));

    expect(error.limit).toBe("team");
    expect(error.max).toBe(2);
    expect(first.producer).toHaveBeenCalledTimes(1);
    expect(second.producer).toHaveBeenCalledTimes(1);
    expect(third.producer).not.toHaveBeenCalled();
  });

  it("applies the process limit alone when no team is at its own limit", () => {
    setCaps(10, 3);
    const service = new QueryService();
    service.startAsyncJob("t1", pending().producer);
    service.startAsyncJob("t2", pending().producer);
    service.startAsyncJob("t3", pending().producer);
    const refused = pending();

    const error = refusal(() => service.startAsyncJob("t4", refused.producer));

    expect(error.limit).toBe("process");
    expect(error.max).toBe(3);
    expect(refused.producer).not.toHaveBeenCalled();
  });

  it("reports the team limit when both limits are reached", () => {
    setCaps(2, 2);
    const service = new QueryService();
    service.startAsyncJob("t1", pending().producer);
    service.startAsyncJob("t1", pending().producer);

    expect(refusal(() => service.startAsyncJob("t1", pending().producer)).limit).toBe("team");
    // A team with no job of its own is refused by the process limit.
    expect(refusal(() => service.startAsyncJob("t2", pending().producer)).limit).toBe("process");
  });

  it("does not let one team's full cap block another team", () => {
    setCaps(2, 100);
    const service = new QueryService();
    service.startAsyncJob("t1", pending().producer);
    service.startAsyncJob("t1", pending().producer);
    refusal(() => service.startAsyncJob("t1", pending().producer));
    const other = pending();

    const started = service.startAsyncJob("t2", other.producer);

    expect(started.requestId).toBeTruthy();
    expect(other.producer).toHaveBeenCalledTimes(1);
  });

  it("frees a slot when a job completes", async () => {
    setCaps(2, 100);
    const service = new QueryService();
    const first = pending();
    service.startAsyncJob("t1", first.producer);
    service.startAsyncJob("t1", pending().producer);
    refusal(() => service.startAsyncJob("t1", pending().producer));

    first.d.resolve({ ok: true });
    await settle();

    expect(() => service.startAsyncJob("t1", pending().producer)).not.toThrow();
    refusal(() => service.startAsyncJob("t1", pending().producer));
  });

  it("frees a slot when a job fails", async () => {
    setCaps(2, 100);
    const service = new QueryService();
    const first = pending();
    service.startAsyncJob("t1", first.producer);
    service.startAsyncJob("t1", pending().producer);
    refusal(() => service.startAsyncJob("t1", pending().producer));

    first.d.reject(new Error("boom"));
    await settle();

    expect(() => service.startAsyncJob("t1", pending().producer)).not.toThrow();
  });

  it("frees the slot of a job that never settles once it expires", () => {
    vi.useFakeTimers();
    setCaps(2, 100);
    const service = new QueryService();
    service.startAsyncJob("t1", pending().producer);
    service.startAsyncJob("t1", pending().producer);
    refusal(() => service.startAsyncJob("t1", pending().producer));

    vi.advanceTimersByTime(4 * 60 * 1000);
    refusal(() => service.startAsyncJob("t1", pending().producer));

    vi.advanceTimersByTime(60 * 1000 + 1);
    expect(() => service.startAsyncJob("t1", pending().producer)).not.toThrow();
  });

  it("does not count completed or failed jobs as in flight", async () => {
    setCaps(2, 2);
    const service = new QueryService();
    service.startAsyncJob("t1", () => Promise.resolve("done"));
    service.startAsyncJob("t1", () => Promise.reject(new Error("boom")));
    await settle();

    // Both limits are 2 and two records of t1 exist, both settled.
    expect(() => service.startAsyncJob("t1", pending().producer)).not.toThrow();
    expect(() => service.startAsyncJob("t2", pending().producer)).not.toThrow();
  });

  it("settles a job whose producer throws before returning a promise and frees its slot", async () => {
    setCaps(1, 100);
    const service = new QueryService();
    const { requestId } = service.startAsyncJob("t1", () => {
      throw new Error("sync boom");
    });
    await settle();

    expect(service.getAsyncJob(requestId)).toMatchObject({ status: "failed", error: "sync boom" });
    expect(() => service.startAsyncJob("t1", pending().producer)).not.toThrow();
  });

  it("names the limit in the refusal message", () => {
    setCaps(1, 100);
    const service = new QueryService();
    service.startAsyncJob("t1", pending().producer);

    expect(refusal(() => service.startAsyncJob("t1", pending().producer)).message).toBe(
      "Team already has 1 async query jobs in flight",
    );
  });
});

describe("QueryService sync slots", () => {
  const caps = config as { asyncJobsMaxInflightPerTeam: number; asyncJobsMaxInflight: number };

  function refused(fn: () => unknown): AsyncJobCapError {
    try {
      fn();
    } catch (error) {
      expect(error).toBeInstanceOf(AsyncJobCapError);
      return error as AsyncJobCapError;
    }
    throw new Error("expected the reservation to be refused");
  }

  beforeEach(() => {
    vi.clearAllMocks();
    caps.asyncJobsMaxInflightPerTeam = 10;
    caps.asyncJobsMaxInflight = 100;
  });

  afterEach(() => {
    caps.asyncJobsMaxInflightPerTeam = 10;
    caps.asyncJobsMaxInflight = 100;
    vi.useRealTimers();
  });

  it("counts a reserved slot against the team limit and refuses the next reservation and job", () => {
    caps.asyncJobsMaxInflightPerTeam = 2;
    const service = new QueryService();
    service.reserveSyncSlot("t1");
    service.reserveSyncSlot("t1");

    const error = refused(() => service.reserveSyncSlot("t1"));

    expect(error.limit).toBe("team");
    expect(error.max).toBe(2);
    const producer = vi.fn(() => new Promise<never>(() => {}));
    refused(() => service.startAsyncJob("t1", producer));
    expect(producer).not.toHaveBeenCalled();
  });

  it("counts a reserved slot against the process limit and leaves another team's own limit alone", () => {
    caps.asyncJobsMaxInflight = 2;
    const service = new QueryService();
    service.reserveSyncSlot("t1");
    service.reserveSyncSlot("t2");

    expect(refused(() => service.reserveSyncSlot("t3")).limit).toBe("process");
  });

  it("counts a job against a later reservation of the same team", () => {
    caps.asyncJobsMaxInflightPerTeam = 1;
    const service = new QueryService();
    service.startAsyncJob("t1", () => new Promise(() => {}));

    refused(() => service.reserveSyncSlot("t1"));
    expect(() => service.reserveSyncSlot("t2")).not.toThrow();
  });

  it("frees the slot on release", () => {
    caps.asyncJobsMaxInflightPerTeam = 1;
    const service = new QueryService();
    const slot = service.reserveSyncSlot("t1");
    refused(() => service.reserveSyncSlot("t1"));

    slot.release();

    expect(() => service.reserveSyncSlot("t1")).not.toThrow();
  });

  it("release twice frees one slot only", () => {
    caps.asyncJobsMaxInflightPerTeam = 2;
    const service = new QueryService();
    const first = service.reserveSyncSlot("t1");
    service.reserveSyncSlot("t1");

    first.release();
    first.release();
    service.reserveSyncSlot("t1");

    refused(() => service.reserveSyncSlot("t1"));
  });

  it("converts the slot into one pending job that adopts the running query, with no second slot", async () => {
    caps.asyncJobsMaxInflightPerTeam = 2;
    const service = new QueryService();
    let finish!: (value: unknown) => void;
    const running = new Promise((resolve) => {
      finish = resolve;
    });
    const slot = service.reserveSyncSlot("t1");

    const job = slot.convertToJob(running);

    expect(service.getAsyncJob(job.requestId)).toMatchObject({ status: "pending", teamId: "t1" });
    // One slot in use, so one more fits and the next one does not.
    service.reserveSyncSlot("t1");
    refused(() => service.reserveSyncSlot("t1"));
    finish({ marker: "adopted" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(service.getAsyncJob(job.requestId)).toMatchObject({
      status: "completed",
      data: { marker: "adopted" },
    });
  });

  it("settles a converted job as failed when the adopted query rejects, and frees its slot", async () => {
    caps.asyncJobsMaxInflightPerTeam = 1;
    const service = new QueryService();
    const slot = service.reserveSyncSlot("t1");
    const job = slot.convertToJob(Promise.reject(new Error("late failure")));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(service.getAsyncJob(job.requestId)).toMatchObject({ status: "failed", error: "late failure" });
    expect(() => service.reserveSyncSlot("t1")).not.toThrow();
  });

  it("keeps the converted job when release is called afterwards", () => {
    caps.asyncJobsMaxInflightPerTeam = 1;
    const service = new QueryService();
    const slot = service.reserveSyncSlot("t1");
    const job = slot.convertToJob(new Promise(() => {}));

    slot.release();

    expect(service.getAsyncJob(job.requestId)).toMatchObject({ status: "pending" });
    refused(() => service.reserveSyncSlot("t1"));
  });

  it("refuses to convert a slot that was released", () => {
    const service = new QueryService();
    const slot = service.reserveSyncSlot("t1");
    slot.release();

    expect(() => slot.convertToJob(new Promise(() => {}))).toThrow("Sync slot already used");
  });

  it("frees a reserved slot that is never released once it expires", () => {
    vi.useFakeTimers();
    caps.asyncJobsMaxInflightPerTeam = 1;
    const service = new QueryService();
    service.reserveSyncSlot("t1");
    refused(() => service.reserveSyncSlot("t1"));

    vi.advanceTimersByTime(5 * 60 * 1000 + 1);

    expect(() => service.reserveSyncSlot("t1")).not.toThrow();
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
