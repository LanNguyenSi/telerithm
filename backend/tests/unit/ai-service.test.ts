import { describe, expect, it, vi } from "vitest";

// Mock config before importing AIService
vi.mock("../../src/config/index.js", () => ({
  config: {
    port: 4000,
    host: "127.0.0.1",
    nodeEnv: "test",
    databaseUrl: "postgresql://test:test@localhost:5432/test",
    clickhouseUrl: "http://localhost:8123",
    logLevel: "silent",
    corsOrigins: "*",
    redisUrl: "redis://localhost:6379",
    openaiApiKey: undefined, // No API key = heuristic mode
  },
}));

vi.mock("../../src/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), fatal: vi.fn() },
}));

import { AIService } from "../../src/services/ai/ai-service.js";

describe("AIService", () => {
  const service = new AIService();

  it("extracts error level filter from natural query", async () => {
    const result = await service.translateQuery("show payment errors", "team-1");
    expect(result.filtersApplied).toContainEqual({
      field: "level",
      operator: "eq",
      value: "error",
    });
  });

  it("extracts warn level filter", async () => {
    const result = await service.translateQuery("show me all warnings", "team-1");
    expect(result.filtersApplied).toContainEqual({
      field: "level",
      operator: "eq",
      value: "warn",
    });
  });

  it("extracts service from 'from <service>' pattern", async () => {
    const result = await service.translateQuery("errors from payment", "team-1");
    expect(result.filtersApplied).toContainEqual({
      field: "service",
      operator: "eq",
      value: "payment",
    });
  });

  it("generates valid SQL with team_id", async () => {
    const result = await service.translateQuery("show errors", "team-abc");
    expect(result.sql).toContain("team_id = 'team-abc'");
    expect(result.sql).toContain("ORDER BY timestamp DESC");
    expect(result.sql).toContain("LIMIT 100");
  });

  it("returns explanation string", async () => {
    const result = await service.translateQuery("show errors", "t1");
    expect(result.explanation).toBeTruthy();
    expect(typeof result.explanation).toBe("string");
  });
});
