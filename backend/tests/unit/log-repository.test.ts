import { beforeEach, describe, expect, it, vi } from "vitest";

const { queryMock } = vi.hoisted(() => ({
  queryMock: vi.fn(),
}));

vi.mock("../../src/logger.js", () => ({
  createChildLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

vi.mock("../../src/repositories/clickhouse.js", () => ({
  clickhouse: {
    query: queryMock,
    insert: vi.fn(),
  },
}));

import { LogRepository } from "../../src/repositories/log-repository.js";

describe("LogRepository search query building", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("builds tokenized search with failure variants", async () => {
    queryMock
      .mockResolvedValueOnce({
        json: vi.fn().mockResolvedValue([{ total: "1" }]),
      })
      .mockResolvedValueOnce({
        json: vi.fn().mockResolvedValue([
          {
            id: "log-1",
            team_id: "t1",
            source_id: "src-1",
            timestamp: "2026-04-01 10:00:00",
            level: "error",
            service: "payment-service",
            host: "play.telerithm.cloud",
            message: "Payment failed",
            fields: {},
          },
        ]),
      });

    const repo = new LogRepository();
    await repo.search({
      teamId: "t1",
      queryType: "sql",
      query: "payment failures",
      limit: 10,
      offset: 0,
    });

    const firstCallArgs = queryMock.mock.calls[0]?.[0];
    expect(firstCallArgs.query).toContain("search_0_0");
    expect(firstCallArgs.query).toContain("AND");
    expect(firstCallArgs.query_params.search_0_0).toBe("%payment%");
    expect(Object.values(firstCallArgs.query_params)).toContain("%fail%");
    expect(Object.values(firstCallArgs.query_params)).toContain("%failure%");
  });
});

describe("LogRepository — buildScopedWhere filter conditions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function makeCountResult(total: number) {
    return { json: vi.fn().mockResolvedValue([{ total: String(total) }]) };
  }
  function makeDataResult(rows: unknown[] = []) {
    return { json: vi.fn().mockResolvedValue(rows) };
  }

  it("builds query with sourceId filter", async () => {
    queryMock.mockResolvedValueOnce(makeCountResult(0)).mockResolvedValueOnce(makeDataResult());

    const repo = new LogRepository();
    await repo.search({ teamId: "t1", queryType: "sql", sourceId: "src-1" });

    const sql = queryMock.mock.calls[0]?.[0].query as string;
    expect(sql).toContain("source_id");
    expect(queryMock.mock.calls[0]?.[0].query_params.sourceId).toBe("src-1");
  });

  it("builds query with time range filters", async () => {
    queryMock.mockResolvedValueOnce(makeCountResult(0)).mockResolvedValueOnce(makeDataResult());

    const repo = new LogRepository();
    await repo.search({
      teamId: "t1",
      queryType: "sql",
      startTime: "2026-04-02T00:00:00.000Z",
      endTime: "2026-04-02T23:59:59.000Z",
    });

    const params = queryMock.mock.calls[0]?.[0].query_params;
    expect(params.startTime).toBeTruthy();
    expect(params.endTime).toBeTruthy();
  });

  it("builds eq filter for level", async () => {
    queryMock.mockResolvedValueOnce(makeCountResult(1)).mockResolvedValueOnce(
      makeDataResult([
        {
          id: "1",
          team_id: "t1",
          source_id: "s1",
          timestamp: "2026-04-02 10:00:00",
          level: "error",
          service: "api",
          host: "h1",
          message: "test",
          fields: {},
        },
      ]),
    );

    const repo = new LogRepository();
    const result = await repo.search({
      teamId: "t1",
      queryType: "sql",
      filters: [{ field: "level", operator: "eq", value: "error" }],
    });

    const sql = queryMock.mock.calls[0]?.[0].query as string;
    expect(sql).toContain("level =");
    expect(result.total).toBe(1);
    expect(result.logs[0].level).toBe("error");
  });

  it("builds contains filter for service", async () => {
    queryMock.mockResolvedValueOnce(makeCountResult(0)).mockResolvedValueOnce(makeDataResult());

    const repo = new LogRepository();
    await repo.search({
      teamId: "t1",
      queryType: "sql",
      filters: [{ field: "service", operator: "contains", value: "payment" }],
    });

    const params = queryMock.mock.calls[0]?.[0].query_params;
    expect(Object.values(params)).toContain("%payment%");
  });

  it("builds neq filter", async () => {
    queryMock.mockResolvedValueOnce(makeCountResult(0)).mockResolvedValueOnce(makeDataResult());

    const repo = new LogRepository();
    await repo.search({
      teamId: "t1",
      queryType: "sql",
      filters: [{ field: "level", operator: "neq", value: "debug" }],
    });

    const sql = queryMock.mock.calls[0]?.[0].query as string;
    expect(sql).toContain("!=");
  });

  it("builds gt filter for fields", async () => {
    queryMock.mockResolvedValueOnce(makeCountResult(0)).mockResolvedValueOnce(makeDataResult());

    const repo = new LogRepository();
    await repo.search({
      teamId: "t1",
      queryType: "sql",
      filters: [{ field: "status_code", operator: "gt", value: "400" }],
    });

    const sql = queryMock.mock.calls[0]?.[0].query as string;
    expect(sql).toContain(">");
  });

  it("builds lt filter for fields", async () => {
    queryMock.mockResolvedValueOnce(makeCountResult(0)).mockResolvedValueOnce(makeDataResult());

    const repo = new LogRepository();
    await repo.search({
      teamId: "t1",
      queryType: "sql",
      filters: [{ field: "status_code", operator: "lt", value: "500" }],
    });

    const sql = queryMock.mock.calls[0]?.[0].query as string;
    expect(sql).toContain("<");
  });

  it("ignores filter with null value gracefully (default operator)", async () => {
    queryMock.mockResolvedValueOnce(makeCountResult(0)).mockResolvedValueOnce(makeDataResult());

    const repo = new LogRepository();
    // invalid operator → buildFilterCondition returns null → condition skipped
    await repo.search({
      teamId: "t1",
      queryType: "sql",
      filters: [{ field: "message", operator: "eq" as never, value: "" }],
    });

    expect(queryMock).toHaveBeenCalledTimes(2);
  });

  it("uses pageToken for offset resolution", async () => {
    queryMock.mockResolvedValueOnce(makeCountResult(200)).mockResolvedValueOnce(makeDataResult());

    const repo = new LogRepository();
    const pageToken = Buffer.from(JSON.stringify({ offset: 50 }), "utf8").toString("base64url");

    await repo.search({ teamId: "t1", queryType: "sql", pageToken, limit: 50 });

    const params = queryMock.mock.calls[1]?.[0].query_params;
    expect(params.offset).toBe(50);
  });

  it("falls back to offset=0 for invalid pageToken", async () => {
    queryMock.mockResolvedValueOnce(makeCountResult(0)).mockResolvedValueOnce(makeDataResult());

    const repo = new LogRepository();
    await repo.search({ teamId: "t1", queryType: "sql", pageToken: "invalid-base64!!" });

    const params = queryMock.mock.calls[1]?.[0].query_params;
    expect(params.offset).toBe(0);
  });

  it("includes nextPageToken when more results exist", async () => {
    queryMock.mockResolvedValueOnce(makeCountResult(100)).mockResolvedValueOnce(makeDataResult());

    const repo = new LogRepository();
    const result = await repo.search({ teamId: "t1", queryType: "sql", limit: 50, offset: 0 });

    expect(result.nextPageToken).toBeTruthy();
  });

  it("no nextPageToken when all results returned", async () => {
    queryMock.mockResolvedValueOnce(makeCountResult(10)).mockResolvedValueOnce(makeDataResult());

    const repo = new LogRepository();
    const result = await repo.search({ teamId: "t1", queryType: "sql", limit: 50, offset: 0 });

    expect(result.nextPageToken).toBeUndefined();
  });

  it("handles sort by service ascending", async () => {
    queryMock.mockResolvedValueOnce(makeCountResult(0)).mockResolvedValueOnce(makeDataResult());

    const repo = new LogRepository();
    await repo.search({
      teamId: "t1",
      queryType: "sql",
      sortBy: "service",
      sortDirection: "asc",
    });

    const sql = queryMock.mock.calls[1]?.[0].query as string;
    expect(sql).toContain("service ASC");
  });
});

describe("LogRepository — search query term expansion", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("strips special characters from search tokens", async () => {
    queryMock
      .mockResolvedValueOnce({ json: vi.fn().mockResolvedValue([{ total: "0" }]) })
      .mockResolvedValueOnce({ json: vi.fn().mockResolvedValue([]) });

    const repo = new LogRepository();
    await repo.search({ teamId: "t1", queryType: "sql", query: "payment-failure!" });

    const params = queryMock.mock.calls[0]?.[0].query_params;
    // special chars stripped, tokens split on whitespace
    expect(Object.values(params)).toContain("%payment-failure%");
  });

  it("returns empty result for single-char query tokens", async () => {
    queryMock
      .mockResolvedValueOnce({ json: vi.fn().mockResolvedValue([{ total: "0" }]) })
      .mockResolvedValueOnce({ json: vi.fn().mockResolvedValue([]) });

    const repo = new LogRepository();
    await repo.search({ teamId: "t1", queryType: "sql", query: "a b" });

    // tokens 'a' and 'b' are length <= 1 — filtered out, no search condition
    const sql = queryMock.mock.calls[0]?.[0].query as string;
    // Should not have ILIKE in count query (no search condition added)
    expect(sql).not.toContain("ILIKE");
  });

  it("expands -ed and -ing suffixes", async () => {
    queryMock
      .mockResolvedValueOnce({ json: vi.fn().mockResolvedValue([{ total: "0" }]) })
      .mockResolvedValueOnce({ json: vi.fn().mockResolvedValue([]) });

    const repo = new LogRepository();
    await repo.search({ teamId: "t1", queryType: "sql", query: "processing" });

    const params = queryMock.mock.calls[0]?.[0].query_params;
    // 'processing' ends with 'ing' (length > 5) → 'process' added as variant
    expect(Object.values(params)).toContain("%process%");
  });
});

describe("LogRepository — findById", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns null when log not found", async () => {
    queryMock.mockResolvedValueOnce({ json: vi.fn().mockResolvedValue([]) });

    const repo = new LogRepository();
    const result = await repo.findById("t1", "non-existent-id");
    expect(result).toBeNull();
  });

  it("returns log entry when found", async () => {
    queryMock.mockResolvedValueOnce({
      json: vi.fn().mockResolvedValue([
        {
          id: "log-abc",
          team_id: "t1",
          source_id: "s1",
          timestamp: "2026-04-02 12:00:00",
          level: "error",
          service: "api",
          host: "host-1",
          message: "Test error",
          fields: { requestId: "xyz" },
        },
      ]),
    });

    const repo = new LogRepository();
    const result = await repo.findById("t1", "log-abc");
    expect(result).not.toBeNull();
    expect(result!.id).toBe("log-abc");
    expect(result!.level).toBe("error");
    expect(result!.fields).toEqual({ requestId: "xyz" });
  });
});

describe("LogRepository — getFacets", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns empty facets when no fields requested", async () => {
    const repo = new LogRepository();
    const result = await repo.getFacets({ teamId: "t1", queryType: "sql", fields: [], limit: 10 });
    expect(result.facets).toEqual([]);
    expect(queryMock).not.toHaveBeenCalled();
  });

  it("returns facets for requested fields", async () => {
    queryMock.mockResolvedValue({
      json: vi.fn().mockResolvedValue([
        { value: "error", count: "42" },
        { value: "warn", count: "10" },
      ]),
    });

    const repo = new LogRepository();
    const result = await repo.getFacets({ teamId: "t1", queryType: "sql", fields: ["level"], limit: 10 });
    expect(result.facets).toHaveLength(1);
    expect(result.facets[0].field).toBe("level");
    expect(result.facets[0].buckets[0]).toEqual({ value: "error", count: 42 });
  });

  it("ignores unknown field names", async () => {
    const repo = new LogRepository();
    const result = await repo.getFacets({
      teamId: "t1",
      queryType: "sql",
      fields: ["nonexistent" as never],
      limit: 10,
    });
    expect(result.facets).toEqual([]);
  });
});
