import { beforeEach, describe, expect, it, vi } from "vitest";

const mockCreate = vi.fn();

vi.mock("openai", () => {
  return {
    default: vi.fn().mockImplementation(() => ({
      chat: {
        completions: {
          create: mockCreate,
        },
      },
    })),
  };
});

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
    openaiApiKey: "test-api-key-for-mocking",
  },
}));

vi.mock("../../src/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), fatal: vi.fn() },
}));

import { AIService } from "../../src/services/ai/ai-service.js";

function makeLLMResponse(override: Record<string, unknown> = {}) {
  return {
    choices: [
      {
        message: {
          content: JSON.stringify({
            explanation: "Test explanation",
            filtersApplied: [],
            inferredTimeRange: null,
            textTerms: ["payment", "error"],
            warnings: [],
            ...override,
          }),
        },
      },
    ],
  };
}

describe("AIService — LLM path (with mocked OpenAI)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uses LLM translation when API key is configured", async () => {
    mockCreate.mockResolvedValueOnce(makeLLMResponse());

    const service = new AIService();
    const result = await service.translateQuery("payment errors", "team-1");

    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(result.explanation).toBe("Test explanation");
    expect(result.textTerms).toContain("payment");
  });

  it("includes facetHints in system prompt", async () => {
    mockCreate.mockResolvedValueOnce(makeLLMResponse());

    const service = new AIService();
    await service.translateQuery("payment errors", "team-1", {
      facetHints: { service: ["payment-service"], level: ["error"] },
    });

    const systemPrompt = mockCreate.mock.calls[0]?.[0].messages[0]?.content as string;
    expect(systemPrompt).toContain("payment-service");
    expect(systemPrompt).toContain("error");
  });

  it("includes formContext in system prompt when provided", async () => {
    mockCreate.mockResolvedValueOnce(makeLLMResponse());

    const service = new AIService();
    await service.translateQuery("errors from last hour", "team-1", {
      formContext: {
        currentTimeRange: { startTime: "2026-04-02T00:00:00Z", endTime: "2026-04-02T23:59:59Z" },
        currentFilters: { level: "error", service: "api-gateway" },
        currentRelativeDuration: "24h",
      },
    });

    const systemPrompt = mockCreate.mock.calls[0]?.[0].messages[0]?.content as string;
    expect(systemPrompt).toContain("24h");
    expect(systemPrompt).toContain("level=error");
    expect(systemPrompt).toContain("service=api-gateway");
  });

  it("includes formContext time range in prompt", async () => {
    mockCreate.mockResolvedValueOnce(makeLLMResponse());

    const service = new AIService();
    await service.translateQuery("payment failures", "team-1", {
      formContext: {
        currentTimeRange: { startTime: "2026-04-01T00:00:00Z", endTime: "2026-04-01T23:59:59Z" },
        currentRelativeDuration: "24h",
      },
    });

    const systemPrompt = mockCreate.mock.calls[0]?.[0].messages[0]?.content as string;
    expect(systemPrompt).toContain("2026-04-01T00:00:00Z");
  });

  it("parses filters from LLM response correctly", async () => {
    mockCreate.mockResolvedValueOnce(
      makeLLMResponse({
        filtersApplied: [
          { field: "level", operator: "eq", value: "error" },
          { field: "service", operator: "contains", value: "payment" },
        ],
      }),
    );

    const service = new AIService();
    const result = await service.translateQuery("payment errors", "team-1");

    expect(result.filtersApplied).toHaveLength(2);
    expect(result.filtersApplied[0]).toEqual({ field: "level", operator: "eq", value: "error" });
  });

  it("parses inferredTimeRange from LLM response", async () => {
    const aiStart = "2026-04-02T13:00:00.000Z";
    const aiEnd = "2026-04-02T14:00:00.000Z";

    mockCreate.mockResolvedValueOnce(
      makeLLMResponse({
        inferredTimeRange: { startTime: aiStart, endTime: aiEnd },
      }),
    );

    const service = new AIService();
    const result = await service.translateQuery("errors from last hour", "team-1");

    expect(result.inferredTimeRange?.startTime).toBe(aiStart);
    expect(result.inferredTimeRange?.endTime).toBe(aiEnd);
  });

  it("rejects invalid ISO dates in inferredTimeRange", async () => {
    mockCreate.mockResolvedValueOnce(
      makeLLMResponse({
        inferredTimeRange: { startTime: "not-a-date", endTime: "also-not-a-date" },
      }),
    );

    const service = new AIService();
    const result = await service.translateQuery("errors", "team-1");

    expect(result.inferredTimeRange).toBeUndefined();
  });

  it("normalizes level filter value to lowercase", async () => {
    mockCreate.mockResolvedValueOnce(
      makeLLMResponse({
        filtersApplied: [{ field: "level", operator: "eq", value: "ERROR" }],
      }),
    );

    const service = new AIService();
    const result = await service.translateQuery("errors", "team-1");

    expect(result.filtersApplied[0]?.value).toBe("error");
  });

  it("normalizes sourceId field to source_id", async () => {
    mockCreate.mockResolvedValueOnce(
      makeLLMResponse({
        filtersApplied: [{ field: "sourceId", operator: "eq", value: "src-123" }],
      }),
    );

    const service = new AIService();
    const result = await service.translateQuery("source errors", "team-1");

    expect(result.filtersApplied[0]?.field).toBe("source_id");
  });

  it("rejects filters with invalid operator", async () => {
    mockCreate.mockResolvedValueOnce(
      makeLLMResponse({
        filtersApplied: [{ field: "level", operator: "invalid_op", value: "error" }],
      }),
    );

    const service = new AIService();
    const result = await service.translateQuery("errors", "team-1");

    expect(result.filtersApplied).toHaveLength(0);
  });

  it("rejects filters with null field", async () => {
    mockCreate.mockResolvedValueOnce(
      makeLLMResponse({
        filtersApplied: [null, { field: "level", operator: "eq", value: "error" }],
      }),
    );

    const service = new AIService();
    const result = await service.translateQuery("errors", "team-1");

    expect(result.filtersApplied).toHaveLength(1);
  });

  it("falls back to heuristic when LLM throws", async () => {
    mockCreate.mockRejectedValueOnce(new Error("LLM API unavailable"));

    const service = new AIService();
    const result = await service.translateQuery("payment errors", "team-1");

    // Should still return valid response via heuristic fallback
    expect(result.filtersApplied).toBeDefined();
    expect(result.explanation).toBeTruthy();
    expect(result.warnings).toBeDefined();
    expect(result.warnings![0]).toContain("heuristic");
  });

  it("handles LLM returning empty content", async () => {
    mockCreate.mockResolvedValueOnce({ choices: [{ message: { content: null } }] });

    const service = new AIService();
    // Should fall back to heuristic
    const result = await service.translateQuery("errors", "team-1");
    expect(result.filtersApplied).toBeDefined();
  });

  it("filters empty warnings from LLM response", async () => {
    mockCreate.mockResolvedValueOnce(
      makeLLMResponse({
        warnings: ["valid warning", "", "   ", "another valid warning"],
      }),
    );

    const service = new AIService();
    const result = await service.translateQuery("errors", "team-1");

    expect(result.warnings).toHaveLength(2);
    expect(result.warnings).toContain("valid warning");
    expect(result.warnings).toContain("another valid warning");
  });

  it("expands multi-word textTerms (splits on whitespace)", async () => {
    mockCreate.mockResolvedValueOnce(
      makeLLMResponse({
        textTerms: ["payment failure", "timeout error"],
      }),
    );

    const service = new AIService();
    const result = await service.translateQuery("errors", "team-1");

    // Multi-word terms should be split into individual tokens
    expect(result.textTerms).toContain("payment");
    expect(result.textTerms).toContain("failure");
  });

  it("uses formContext without currentFilters (only time range)", async () => {
    mockCreate.mockResolvedValueOnce(makeLLMResponse());

    const service = new AIService();
    await service.translateQuery("errors", "team-1", {
      formContext: {
        currentTimeRange: { startTime: "2026-04-01T00:00:00Z", endTime: "2026-04-01T23:59:59Z" },
        // no currentFilters
      },
    });

    // Should not throw
    const systemPrompt = mockCreate.mock.calls[0]?.[0].messages[0]?.content as string;
    expect(systemPrompt).toContain("2026-04-01T00:00:00Z");
  });
});
