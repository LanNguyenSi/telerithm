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

describe("QueryService natural search", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("drops hallucinated host filters, downgrades service eq to contains, and retries with relaxed filters", async () => {
    getFacetsMock.mockResolvedValue({
      facets: [
        { field: "service", buckets: [{ value: "payment-service", count: 10 }] },
        { field: "host", buckets: [{ value: "play.telerithm.cloud", count: 10 }] },
        { field: "level", buckets: [{ value: "error", count: 10 }] },
      ],
    });

    translateQueryMock.mockResolvedValue({
      explanation: "test",
      filtersApplied: [
        { field: "message", operator: "contains", value: "payment failure" },
        { field: "service", operator: "eq", value: "payment" },
        { field: "host", operator: "eq", value: "api-1" },
      ],
      textTerms: ["payment", "failures", "fail", "failed"],
      warnings: [],
    });

    searchMock
      .mockResolvedValueOnce({
        logs: [],
        total: 0,
        requestId: "",
        partial: false,
        query: "first",
        executionTimeMs: 1,
        cached: false,
      })
      .mockResolvedValueOnce({
        logs: [{ id: "1" }],
        total: 10,
        requestId: "",
        partial: false,
        query: "second",
        executionTimeMs: 1,
        cached: false,
      });

    const service = new QueryService();
    const result = await service.search({
      teamId: "t1",
      queryType: "natural",
      query: "show me payment failures",
    });

    expect(result.total).toBe(10);
    expect(searchMock).toHaveBeenCalledTimes(2);

    const firstQuery = searchMock.mock.calls[0]?.[0];
    expect(firstQuery.filters).toEqual(
      expect.arrayContaining([
        { field: "service", operator: "contains", value: "payment" },
        { field: "message", operator: "contains", value: "payment failure" },
      ]),
    );
    expect(firstQuery.filters).not.toEqual(
      expect.arrayContaining([{ field: "host", operator: "eq", value: "api-1" }]),
    );

    const secondQuery = searchMock.mock.calls[1]?.[0];
    expect(secondQuery.filters).toEqual([]);
    expect(nlqFilterPrunedTotalIncMock).toHaveBeenCalledWith({ field: "host", reason: "unknown_value" });
    expect(nlqRelaxedFallbackUsedTotalIncMock).toHaveBeenCalledWith({ result: "triggered" });
    expect(nlqRelaxedFallbackUsedTotalIncMock).toHaveBeenCalledWith({ result: "recovered" });
  });
});
