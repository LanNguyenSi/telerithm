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
      operator: "contains",
      value: "payment",
    });
  });

  it("returns structured plan without SQL passthrough", async () => {
    const result = await service.translateQuery("show errors", "team-abc");
    expect(result).not.toHaveProperty("sql");
    expect(Array.isArray(result.filtersApplied)).toBe(true);
  });

  it("returns extracted text terms for deterministic search fallback", async () => {
    const result = await service.translateQuery("show payment errors in checkout service", "team-abc");
    expect(result.textTerms).toBeDefined();
    expect(result.textTerms?.length).toBeGreaterThan(0);
  });

  it("keeps failure terms unexpanded in ai-service output", async () => {
    const result = await service.translateQuery("show me payment failures", "team-abc");
    expect(result.textTerms).toEqual(expect.arrayContaining(["payment", "failures"]));
    expect(result.textTerms).not.toEqual(expect.arrayContaining(["failure", "fail", "failed"]));
  });

  it("returns explanation string", async () => {
    const result = await service.translateQuery("show errors", "t1");
    expect(result.explanation).toBeTruthy();
    expect(typeof result.explanation).toBe("string");
  });

  describe("domain stopword filtering (heuristic mode)", () => {
    it("strips 'logs' from textTerms — 'show payment logs'", async () => {
      const result = await service.translateQuery("show payment logs", "team-1");
      expect(result.textTerms).not.toContain("logs");
    });

    it("strips 'show' and 'me' from textTerms — 'show me all entries'", async () => {
      const result = await service.translateQuery("show me all entries", "team-1");
      expect(result.textTerms).not.toContain("show");
      expect(result.textTerms).not.toContain("me");
    });

    it("does NOT strip content words — 'connection timeout logs'", async () => {
      const result = await service.translateQuery("connection timeout logs", "team-1");
      expect(result.textTerms).toContain("connection");
      expect(result.textTerms).toContain("timeout");
    });

    it("does NOT strip 'failures' — content word, not meta-word", async () => {
      const result = await service.translateQuery("show payment failures", "team-1");
      expect(result.textTerms).not.toContain("show");
      const hasFailure = (result.textTerms ?? []).some((t) => t.includes("failure"));
      expect(hasFailure).toBe(true);
    });
  });
});

describe("AIService — heuristic: service extraction edge cases", () => {
  const service = new AIService();

  it("falls back to token-based service detection when no 'from' pattern", async () => {
    const result = await service.translateQuery("checkout errors", "team-1");
    // 'checkout' should be picked up as a service candidate
    const serviceFilter = result.filtersApplied.find((f) => f.field === "service");
    expect(serviceFilter).toBeDefined();
  });

  it("does not treat time words as service names", async () => {
    const result = await service.translateQuery("errors from the last hour", "team-1");
    const serviceFilter = result.filtersApplied.find((f) => f.field === "service");
    // 'the', 'last', 'hour' are time words — should not become service filters
    if (serviceFilter) {
      expect(serviceFilter.value).not.toMatch(/^(the|last|hour|past|next|this)$/);
    }
  });

  it("returns warning in heuristic mode", async () => {
    const result = await service.translateQuery("show errors", "team-1");
    expect(result.warnings).toBeDefined();
    expect(result.warnings!.length).toBeGreaterThan(0);
    expect(result.warnings![0]).toContain("heuristic");
  });

  it("textTerms limited to 5 items", async () => {
    const result = await service.translateQuery(
      "show payment checkout billing invoice order errors",
      "team-1",
    );
    expect((result.textTerms ?? []).length).toBeLessThanOrEqual(5);
  });

  it("translateQueryHeuristicPublic is callable directly", () => {
    const result = service.translateQueryHeuristicPublic("show errors", "team-1");
    expect(result.filtersApplied).toBeDefined();
    expect(Array.isArray(result.filtersApplied)).toBe(true);
    expect(result.explanation).toBeTruthy();
  });

  it("heuristic handles warn level correctly", async () => {
    const result = await service.translateQuery("show warnings from api", "team-1");
    expect(result.filtersApplied).toContainEqual({
      field: "level",
      operator: "eq",
      value: "warn",
    });
  });

  it("facetHints passed to heuristic are accepted without error", async () => {
    const result = await service.translateQuery("payment errors", "team-1", {
      facetHints: {
        service: ["payment-service", "api-gateway"],
        level: ["error", "warn"],
      },
    });
    expect(result.filtersApplied).toBeDefined();
  });
});

describe("AIService — translateQueryHeuristicPublic direct", () => {
  it("returns a valid NLQTranslation with all required fields", () => {
    const service = new AIService();
    const result = service.translateQueryHeuristicPublic("show payment failures from api", "team-xyz");
    expect(result.filtersApplied).toBeDefined();
    expect(Array.isArray(result.filtersApplied)).toBe(true);
    expect(result.explanation).toBeTruthy();
    expect(Array.isArray(result.textTerms)).toBe(true);
    expect(Array.isArray(result.warnings)).toBe(true);
  });

  it("includes team ID in explanation", () => {
    const service = new AIService();
    const result = service.translateQueryHeuristicPublic("errors", "my-team");
    expect(result.explanation).toContain("my-team");
  });

  it("does not emit more than 5 textTerms", () => {
    const service = new AIService();
    const result = service.translateQueryHeuristicPublic(
      "alpha beta gamma delta epsilon zeta eta theta",
      "t1",
    );
    expect((result.textTerms ?? []).length).toBeLessThanOrEqual(5);
  });
});
