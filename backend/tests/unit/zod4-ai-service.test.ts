import { beforeEach, describe, expect, it, vi } from "vitest";

const mockCreate = vi.fn();

vi.mock("openai", async () => {
  const actual = await vi.importActual<{ default: Record<string, unknown> }>("openai");
  const MockOpenAI = vi.fn().mockImplementation(function () {
    return {
      chat: {
        completions: {
          create: mockCreate,
        },
      },
    };
  });
  Object.assign(MockOpenAI, {
    APIError: actual.default.APIError,
    APIConnectionError: actual.default.APIConnectionError,
    APIConnectionTimeoutError: actual.default.APIConnectionTimeoutError,
  });
  return { default: MockOpenAI };
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
    openaiModel: "test-model",
    openaiTimeoutMs: 10000,
  },
}));

vi.mock("../../src/metrics/index.js", () => ({
  nlqLlmDuration: { startTimer: vi.fn(() => vi.fn()) },
  nlqLlmErrorsTotal: { inc: vi.fn() },
  nlqLlmFallbackTotal: { inc: vi.fn() },
  nlqFilterPrunedTotal: { inc: vi.fn() },
  nlqRelaxedFallbackUsedTotal: { inc: vi.fn() },
}));

vi.mock("../../src/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), fatal: vi.fn() },
}));

import { AIService } from "../../src/services/ai/ai-service.js";

// zod 3 -> 4 pin: zod 3's z.number() accepted Infinity, zod 4's rejects it.
// An LLM can emit the JSON number `1e999`, which JSON.parse turns into
// Infinity, so the NLQ response schema must keep accepting it (otherwise the
// whole response falls back to the heuristic instead of keeping the filter).
describe("AIService LLM response schema keeps the zod 3 number accept-set", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("keeps an LLM filter value of 1e999 (Infinity) instead of failing the response schema", async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [
        {
          message: {
            content:
              '{"explanation":"x","filtersApplied":[{"field":"service","operator":"contains","value":1e999}],"inferredTimeRange":null,"textTerms":[],"warnings":[]}',
          },
        },
      ],
    });

    const service = new AIService();
    const result = await service.translateQuery("everything is broken", "team-1");

    expect(result.filtersApplied).toEqual([{ field: "service", operator: "contains", value: Infinity }]);
    expect(result.warnings ?? []).not.toContain(expect.stringContaining("fallback mode active"));
  });
});
