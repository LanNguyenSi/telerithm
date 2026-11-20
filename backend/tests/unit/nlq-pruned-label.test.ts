import { beforeEach, describe, expect, it, vi } from "vitest";

const mockCreate = vi.fn();
const { nlqFilterPrunedIncMock } = vi.hoisted(() => ({ nlqFilterPrunedIncMock: vi.fn() }));

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
  nlqFilterPrunedTotal: { inc: nlqFilterPrunedIncMock },
  nlqRelaxedFallbackUsedTotal: { inc: vi.fn() },
}));

vi.mock("../../src/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), fatal: vi.fn() },
}));

import { AIService, NLQ_UNKNOWN_FIELD_LABEL } from "../../src/services/ai/ai-service.js";

const ALLOWED_FIELDS = [
  "level",
  "service",
  "host",
  "message",
  "sourceId",
  "env",
  "region",
  "status_code",
  "route",
];

function llmResponseWithFilters(filters: Array<{ field: string; operator: string; value: string }>) {
  return {
    choices: [
      {
        message: {
          content: JSON.stringify({
            explanation: "test",
            filtersApplied: filters,
            inferredTimeRange: null,
            textTerms: [],
            warnings: [],
          }),
        },
      },
    ],
  };
}

function prunedLabelCalls(): Array<{ field: string; reason: string }> {
  return nlqFilterPrunedIncMock.mock.calls.map((call) => call[0] as { field: string; reason: string });
}

describe("nlqFilterPrunedTotal field label is bounded", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("exports the bounded label constant as _unknown", () => {
    expect(NLQ_UNKNOWN_FIELD_LABEL).toBe("_unknown");
  });

  it("counts 25 distinct unknown fields under at most one new field label", async () => {
    const unknownFields = Array.from({ length: 25 }, (_, index) => `x_custom_field_${index}`);
    mockCreate.mockResolvedValueOnce(
      llmResponseWithFilters(unknownFields.map((field) => ({ field, operator: "eq", value: "v" }))),
    );

    const result = await new AIService().translateQuery("errors", "team-1");

    // Every unknown field is still dropped from the plan.
    expect(result.filtersApplied).toHaveLength(0);

    const calls = prunedLabelCalls();
    expect(calls).toHaveLength(25);
    const distinctFields = new Set(calls.map((call) => call.field));
    expect(distinctFields.size).toBe(1);
    expect(distinctFields.has(NLQ_UNKNOWN_FIELD_LABEL)).toBe(true);
    expect(calls.every((call) => call.reason === "unknown_field")).toBe(true);
    // None of the AI-invented names reaches the label.
    for (const field of unknownFields) {
      expect(distinctFields.has(field)).toBe(false);
    }
  });

  it("labels an over-long or injection-style unknown field with the constant", async () => {
    const longField = "a".repeat(200);
    const injectionField = "'; DROP TABLE logs; --";
    mockCreate.mockResolvedValueOnce(
      llmResponseWithFilters([
        { field: longField, operator: "eq", value: "v" },
        { field: injectionField, operator: "eq", value: "v" },
      ]),
    );

    await new AIService().translateQuery("errors", "team-1");

    expect(nlqFilterPrunedIncMock).toHaveBeenCalledTimes(2);
    expect(nlqFilterPrunedIncMock).toHaveBeenNthCalledWith(1, {
      field: NLQ_UNKNOWN_FIELD_LABEL,
      reason: "unknown_field",
    });
    expect(nlqFilterPrunedIncMock).toHaveBeenNthCalledWith(2, {
      field: NLQ_UNKNOWN_FIELD_LABEL,
      reason: "unknown_field",
    });
    const labels = prunedLabelCalls().map((call) => call.field);
    expect(labels).not.toContain(longField);
    expect(labels).not.toContain(longField.slice(0, 64));
    expect(labels).not.toContain(injectionField);
  });

  it("does not label allowlisted fields at all: keep them and add no pruned count", async () => {
    mockCreate.mockResolvedValueOnce(
      llmResponseWithFilters(ALLOWED_FIELDS.map((field) => ({ field, operator: "eq", value: "v" }))),
    );

    const result = await new AIService().translateQuery("errors", "team-1");

    expect(result.filtersApplied).toHaveLength(ALLOWED_FIELDS.length);
    // An allowlisted field must never be counted as pruned, so it can never
    // fall back to the _unknown label either.
    expect(nlqFilterPrunedIncMock).not.toHaveBeenCalled();
  });
});
