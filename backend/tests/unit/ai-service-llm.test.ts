import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockCreate = vi.fn();

vi.mock("openai", async () => {
  // Keep the SDK's real error classes on the mocked constructor so the
  // service's instanceof checks run against the real class hierarchy.
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
import { config } from "../../src/config/index.js";
import { nlqLlmErrorsTotal } from "../../src/metrics/index.js";
import OpenAI from "openai";

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

// ── Field allowlist enforcement ──────────────────────────────────────────────

describe("AIService — normalizeFilter field allowlist", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("drops a filter whose field is not in the permitted set (hallucinated name)", async () => {
    mockCreate.mockResolvedValueOnce(
      makeLLMResponse({
        filtersApplied: [{ field: "admin_user_secret", operator: "eq", value: "true" }],
      }),
    );

    const service = new AIService();
    const result = await service.translateQuery("errors", "team-1");

    // The disallowed field must be silently dropped.
    expect(result.filtersApplied).toHaveLength(0);
  });

  it("keeps a filter whose field is in the permitted set (env)", async () => {
    mockCreate.mockResolvedValueOnce(
      makeLLMResponse({
        filtersApplied: [{ field: "env", operator: "eq", value: "production" }],
      }),
    );

    const service = new AIService();
    const result = await service.translateQuery("production errors", "team-1");

    expect(result.filtersApplied).toHaveLength(1);
    expect(result.filtersApplied[0]).toEqual({ field: "env", operator: "eq", value: "production" });
  });

  it("keeps all permitted core fields: level, service, host, message, sourceId", async () => {
    mockCreate.mockResolvedValueOnce(
      makeLLMResponse({
        filtersApplied: [
          { field: "level", operator: "eq", value: "error" },
          { field: "service", operator: "contains", value: "payment" },
          { field: "host", operator: "eq", value: "web-01" },
          { field: "message", operator: "contains", value: "timeout" },
          { field: "sourceId", operator: "eq", value: "src-123" },
        ],
      }),
    );

    const service = new AIService();
    const result = await service.translateQuery("errors", "team-1");

    expect(result.filtersApplied).toHaveLength(5);
    // sourceId must be normalized to source_id
    expect(result.filtersApplied.find((f) => f.field === "source_id")).toBeDefined();
  });

  it("drops disallowed fields while passing allowed ones in a mixed list", async () => {
    mockCreate.mockResolvedValueOnce(
      makeLLMResponse({
        filtersApplied: [
          { field: "level", operator: "eq", value: "warn" },
          { field: "internal_secret", operator: "eq", value: "anything" },
          { field: "region", operator: "eq", value: "eu-west-1" },
          { field: "'; DROP TABLE logs; --", operator: "eq", value: "x" },
        ],
      }),
    );

    const service = new AIService();
    const result = await service.translateQuery("errors", "team-1");

    const fields = result.filtersApplied.map((f) => f.field);
    expect(fields).toContain("level");
    expect(fields).toContain("region");
    expect(fields).not.toContain("internal_secret");
    // SQL injection attempt must be absent
    expect(fields.some((f) => f.includes("DROP"))).toBe(false);
    expect(result.filtersApplied).toHaveLength(2);
  });
});

// ── Retry, timeout, schema validation ───────────────────────────────────────

describe("retry and error handling", () => {
  let service: AIService;

  beforeEach(() => {
    mockCreate.mockReset();
    service = new AIService();
  });

  it("falls back to heuristic after LLM failure", async () => {
    mockCreate.mockImplementation(() => Promise.reject(new Error("network timeout")));

    const result = await service.translateQuery("show errors", "team-1");
    expect(result.warnings).toContain("AI fallback mode active: heuristic interpretation was used.");
  });

  it("does not retry on non-retryable errors (parse)", async () => {
    mockCreate.mockImplementation(() => Promise.reject(new SyntaxError("Unexpected token")));

    const result = await service.translateQuery("show errors", "team-1");
    // Should fall back immediately without retry
    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(result.warnings).toContain("AI fallback mode active: heuristic interpretation was used.");
  });

  it("falls back to heuristic when LLM returns malformed JSON", async () => {
    mockCreate.mockImplementation(() => Promise.resolve({
      choices: [{ message: { content: "not valid json {{{" } }],
    }));

    const result = await service.translateQuery("show errors", "team-1");
    expect(result.warnings).toContain("AI fallback mode active: heuristic interpretation was used.");
  });

  it("falls back to heuristic when LLM response fails schema validation", async () => {
    mockCreate.mockImplementation(() => Promise.resolve({
      choices: [
        {
          message: {
            content: JSON.stringify({
              explanation: 123, // wrong type — should be string
              filtersApplied: "not an array",
            }),
          },
        },
      ],
    }));

    const result = await service.translateQuery("show errors", "team-1");
    // filtersApplied is wrong type → Zod rejects → heuristic fallback
    expect(result.warnings).toContain("AI fallback mode active: heuristic interpretation was used.");
  });

  it("accepts a valid LLM response through schema validation", async () => {
    mockCreate.mockImplementation(() => Promise.resolve(
      makeLLMResponse({
        explanation: "Found payment errors",
        filtersApplied: [{ field: "level", operator: "eq", value: "error" }],
        textTerms: ["payment"],
      }),
    ));

    const result = await service.translateQuery("payment errors", "team-1");
    expect(result.explanation).toBe("Found payment errors");
    expect(result.filtersApplied).toHaveLength(1);
    expect(result.filtersApplied[0].field).toBe("level");
  });
});

describe("AIService model selection", () => {
  const configuredModel = config.openaiModel;

  beforeEach(() => {
    mockCreate.mockReset();
    mockCreate.mockResolvedValueOnce(makeLLMResponse());
  });

  afterEach(() => {
    (config as { openaiModel?: string }).openaiModel = configuredModel;
  });

  it("defaults to openai/gpt-oss-120b with low reasoning effort when OPENAI_MODEL is unset", async () => {
    (config as { openaiModel?: string }).openaiModel = undefined;

    await new AIService().translateQuery("payment errors", "team-1");

    const callArg = mockCreate.mock.calls[0]?.[0];
    expect(callArg.model).toBe("openai/gpt-oss-120b");
    expect(callArg.reasoning_effort).toBe("low");
  });

  it("falls back to the default model when OPENAI_MODEL is blank", async () => {
    (config as { openaiModel?: string }).openaiModel = "  ";

    await new AIService().translateQuery("payment errors", "team-1");

    expect(mockCreate.mock.calls[0]?.[0].model).toBe("openai/gpt-oss-120b");
  });

  it("uses OPENAI_MODEL as given and sends no reasoning_effort for a non-reasoning model", async () => {
    await new AIService().translateQuery("payment errors", "team-1");

    const callArg = mockCreate.mock.calls[0]?.[0];
    expect(callArg.model).toBe("test-model");
    expect(callArg).not.toHaveProperty("reasoning_effort");
  });
});

// ── Error classification ────────────────────────────────────────────────────

describe("LLM error classification", () => {
  const FALLBACK = "AI fallback mode active: heuristic interpretation was used.";
  let service: AIService;

  beforeEach(() => {
    vi.clearAllMocks();
    mockCreate.mockReset();
    vi.useFakeTimers();
    service = new AIService();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  async function run() {
    const promise = service.translateQuery("show errors", "team-1");
    await vi.runAllTimersAsync();
    return promise;
  }

  const apiError = (status: number) =>
    OpenAI.APIError.generate(status, { message: "boom" }, "boom", new Headers());

  it("classifies APIConnectionTimeoutError as timeout and retries it", async () => {
    mockCreate.mockImplementation(() => Promise.reject(new OpenAI.APIConnectionTimeoutError()));

    const result = await run();

    expect(mockCreate).toHaveBeenCalledTimes(3);
    expect(nlqLlmErrorsTotal.inc).toHaveBeenCalledTimes(1);
    expect(nlqLlmErrorsTotal.inc).toHaveBeenCalledWith({ type: "timeout" });
    expect(result.warnings).toContain(FALLBACK);
  });

  it("classifies APIConnectionError as timeout and retries it", async () => {
    mockCreate.mockImplementation(() =>
      Promise.reject(new OpenAI.APIConnectionError({ message: "socket hang up" })),
    );

    await run();

    expect(mockCreate).toHaveBeenCalledTimes(3);
    expect(nlqLlmErrorsTotal.inc).toHaveBeenCalledTimes(1);
    expect(nlqLlmErrorsTotal.inc).toHaveBeenCalledWith({ type: "timeout" });
  });

  it.each([400, 404])("classifies HTTP %i as model_or_request and does not retry", async (status) => {
    mockCreate.mockImplementation(() => Promise.reject(apiError(status)));

    const result = await run();

    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(nlqLlmErrorsTotal.inc).toHaveBeenCalledTimes(1);
    expect(nlqLlmErrorsTotal.inc).toHaveBeenCalledWith({ type: "model_or_request" });
    expect(result.warnings).toContain(FALLBACK);
  });

  it("classifies 429 as rate_limit and retries it", async () => {
    mockCreate.mockImplementation(() => Promise.reject(apiError(429)));

    await run();

    expect(mockCreate).toHaveBeenCalledTimes(3);
    expect(nlqLlmErrorsTotal.inc).toHaveBeenCalledTimes(1);
    expect(nlqLlmErrorsTotal.inc).toHaveBeenCalledWith({ type: "rate_limit" });
  });

  it("classifies 500 as server and retries it", async () => {
    mockCreate.mockImplementation(() => Promise.reject(apiError(500)));

    await run();

    expect(mockCreate).toHaveBeenCalledTimes(3);
    expect(nlqLlmErrorsTotal.inc).toHaveBeenCalledTimes(1);
    expect(nlqLlmErrorsTotal.inc).toHaveBeenCalledWith({ type: "server" });
  });

  it.each([401, 403])("classifies %i as auth and does not retry", async (status) => {
    mockCreate.mockImplementation(() => Promise.reject(apiError(status)));

    await run();

    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(nlqLlmErrorsTotal.inc).toHaveBeenCalledTimes(1);
    expect(nlqLlmErrorsTotal.inc).toHaveBeenCalledWith({ type: "auth" });
  });

  it("keeps other 4xx statuses as unknown and does not retry", async () => {
    mockCreate.mockImplementation(() => Promise.reject(apiError(418)));

    await run();

    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(nlqLlmErrorsTotal.inc).toHaveBeenCalledTimes(1);
    expect(nlqLlmErrorsTotal.inc).toHaveBeenCalledWith({ type: "unknown" });
  });
});
