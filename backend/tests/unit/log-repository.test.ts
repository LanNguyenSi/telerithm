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
