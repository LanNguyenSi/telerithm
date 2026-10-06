import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The real OpenAI SDK runs here (its retry logic included); only the network
// layer is stubbed by injecting a counting fetch into the client the service
// constructs. This pins the total number of HTTP attempts per translateQuery,
// which a mocked chat.completions.create cannot see.
const fetchStub = vi.fn();

vi.mock("openai", async () => {
  const actual = await vi.importActual<{ default: new (opts: Record<string, unknown>) => unknown }>("openai");
  const Real = actual.default;
  class CountingOpenAI extends (Real as new (opts: Record<string, unknown>) => object) {
    constructor(opts: Record<string, unknown>) {
      super({ ...opts, fetch: fetchStub });
    }
  }
  return { default: CountingOpenAI };
});

vi.mock("../../src/config/index.js", () => ({
  config: {
    nodeEnv: "test",
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
}));

vi.mock("../../src/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), fatal: vi.fn() },
}));

import { AIService } from "../../src/services/ai/ai-service.js";

const FALLBACK = "AI fallback mode active: heuristic interpretation was used.";
// App loop: initial attempt + MAX_RETRIES (2). The SDK must add no attempts.
const EXPECTED_HTTP_ATTEMPTS = 3;

describe("LLM retry ownership (real SDK client, stubbed fetch)", () => {
  let service: AIService;

  beforeEach(() => {
    fetchStub.mockReset();
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

  it("makes exactly 3 HTTP attempts when the LLM hangs until the client timeout", async () => {
    fetchStub.mockImplementation(
      (_url: string, init: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          init.signal.addEventListener("abort", () => reject(new Error("aborted")));
        }),
    );

    const result = await run();

    expect(fetchStub).toHaveBeenCalledTimes(EXPECTED_HTTP_ATTEMPTS);
    expect(result.warnings).toContain(FALLBACK);
  });

  it("makes exactly 3 HTTP attempts on persistent HTTP 429", async () => {
    fetchStub.mockImplementation(
      async () =>
        new Response(JSON.stringify({ error: { message: "slow down" } }), {
          status: 429,
          headers: { "content-type": "application/json" },
        }),
    );

    const result = await run();

    expect(fetchStub).toHaveBeenCalledTimes(EXPECTED_HTTP_ATTEMPTS);
    expect(result.warnings).toContain(FALLBACK);
  });

  it("makes exactly 3 HTTP attempts on persistent HTTP 503", async () => {
    fetchStub.mockImplementation(
      async () =>
        new Response(JSON.stringify({ error: { message: "unavailable" } }), {
          status: 503,
          headers: { "content-type": "application/json" },
        }),
    );

    const result = await run();

    expect(fetchStub).toHaveBeenCalledTimes(EXPECTED_HTTP_ATTEMPTS);
    expect(result.warnings).toContain(FALLBACK);
  });

  // 408 and 409 classify as "unknown", which the app loop does not retry, and
  // the SDK adds no attempt of its own (maxRetries: 0): one HTTP attempt each.
  it.each([408, 409])("makes exactly 1 HTTP attempt on HTTP %i", async (status) => {
    fetchStub.mockImplementation(
      async () =>
        new Response(JSON.stringify({ error: { message: "no retry" } }), {
          status,
          headers: { "content-type": "application/json" },
        }),
    );

    const result = await run();

    expect(fetchStub).toHaveBeenCalledTimes(1);
    expect(result.warnings).toContain(FALLBACK);
  });
});
