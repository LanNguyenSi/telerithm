import { beforeEach, describe, expect, it, vi } from "vitest";
import { ChannelConfigError, ChannelHttpError } from "../../src/services/notification/channels/errors.js";
import { createHmac } from "node:crypto";

// vi.mock calls are hoisted to the top of the file by vitest —
// they must appear before any imports that reference the mocked modules.
vi.mock("../../src/services/notification/safe-fetch.js", () => ({
  safeFetch: vi.fn(),
}));

vi.mock("../../src/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), fatal: vi.fn() },
  createChildLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

import { safeFetch, type SafeFetchInit } from "../../src/services/notification/safe-fetch.js";
import { sendWebhook, type WebhookPayload } from "../../src/services/notification/channels/webhook.js";

const mockSafeFetch = vi.mocked(safeFetch);

// The global fetch must never be used for a user URL: delivery goes through
// safeFetch, which pins the vetted address. Any call here is a regression.
const plainFetch = vi.fn();

const SAMPLE_PAYLOAD: WebhookPayload = {
  incidentId: "inc-001",
  ruleId: "rule-001",
  severity: "critical",
  status: "open",
  message: "Error rate exceeded threshold",
  createdAt: "2024-01-15T10:00:00.000Z",
};

const TARGET_URL = "https://hooks.example.com/webhook";

describe("sendWebhook — HMAC signature", () => {
  beforeEach(() => {
    vi.resetAllMocks();

    // After resetAllMocks, restore default implementations

    mockSafeFetch.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
    });
    globalThis.fetch = plainFetch as unknown as typeof fetch;
  });

  it("adds X-Telerithm-Signature header with correct HMAC-SHA256 when secret is provided", async () => {
    const secret = "webhook-signing-secret";
    await sendWebhook(TARGET_URL, SAMPLE_PAYLOAD, { secret });

    const [, init] = mockSafeFetch.mock.calls[0] as [string, SafeFetchInit & { headers: Record<string, string> }];
    const body = JSON.stringify(SAMPLE_PAYLOAD);
    const expectedSig = "sha256=" + createHmac("sha256", secret).update(body).digest("hex");

    expect(init.headers["X-Telerithm-Signature"]).toBe(expectedSig);
  });

  it("HMAC covers the exact serialized JSON body (no deviation)", async () => {
    const secret = "s3cr3t";
    await sendWebhook(TARGET_URL, SAMPLE_PAYLOAD, { secret });

    const [, init] = mockSafeFetch.mock.calls[0] as [string, SafeFetchInit & { body: string; headers: Record<string, string> }];
    // The body actually sent and the HMAC input must match
    const body = init.body as string;
    const expectedSig = "sha256=" + createHmac("sha256", secret).update(body).digest("hex");

    expect(init.headers["X-Telerithm-Signature"]).toBe(expectedSig);
  });

  it("omits X-Telerithm-Signature when no secret is provided", async () => {
    await sendWebhook(TARGET_URL, SAMPLE_PAYLOAD);

    const [, init] = mockSafeFetch.mock.calls[0] as [string, SafeFetchInit & { headers: Record<string, string> }];
    expect(init.headers["X-Telerithm-Signature"]).toBeUndefined();
  });

  it("omits X-Telerithm-Signature when options object is provided but has no secret", async () => {
    await sendWebhook(TARGET_URL, SAMPLE_PAYLOAD, { headers: { "X-Custom": "val" } });

    const [, init] = mockSafeFetch.mock.calls[0] as [string, SafeFetchInit & { headers: Record<string, string> }];
    expect(init.headers["X-Telerithm-Signature"]).toBeUndefined();
  });
});

describe("sendWebhook: delivery goes through safeFetch (SSRF guard)", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockSafeFetch.mockResolvedValue({ ok: true, status: 200, statusText: "OK" });
    globalThis.fetch = plainFetch as unknown as typeof fetch;
  });

  it("sends through safeFetch with the exact target URL, once per delivery", async () => {
    await sendWebhook(TARGET_URL, SAMPLE_PAYLOAD);
    expect(mockSafeFetch).toHaveBeenCalledOnce();
    expect(mockSafeFetch.mock.calls[0][0]).toBe(TARGET_URL);
  });

  it("never calls the global fetch for the user URL", async () => {
    await sendWebhook(TARGET_URL, SAMPLE_PAYLOAD);
    expect(plainFetch).not.toHaveBeenCalled();
  });

  it("propagates a guard refusal from safeFetch unchanged", async () => {
    const refusal = new ChannelConfigError("Webhook host resolves to a blocked address range");
    mockSafeFetch.mockRejectedValueOnce(refusal);
    await expect(sendWebhook(TARGET_URL, SAMPLE_PAYLOAD)).rejects.toBe(refusal);
    expect(plainFetch).not.toHaveBeenCalled();
  });
});

describe("sendWebhook — HTTP request properties", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockSafeFetch.mockResolvedValue({ ok: true, status: 200, statusText: "OK" });
    globalThis.fetch = plainFetch as unknown as typeof fetch;
  });

  it("sends POST method", async () => {
    await sendWebhook(TARGET_URL, SAMPLE_PAYLOAD);
    const [, init] = mockSafeFetch.mock.calls[0] as [string, SafeFetchInit];
    expect(init.method).toBe("POST");
  });

  it("sends the payload serialized as JSON body", async () => {
    await sendWebhook(TARGET_URL, SAMPLE_PAYLOAD);
    const [, init] = mockSafeFetch.mock.calls[0] as [string, SafeFetchInit & { body: string }];
    expect(JSON.parse(init.body)).toEqual(SAMPLE_PAYLOAD);
  });

  it("sets Content-Type: application/json", async () => {
    await sendWebhook(TARGET_URL, SAMPLE_PAYLOAD);
    const [, init] = mockSafeFetch.mock.calls[0] as [string, SafeFetchInit & { headers: Record<string, string> }];
    expect(init.headers["Content-Type"]).toBe("application/json");
  });

  it("passes the target URL as the first safeFetch argument", async () => {
    await sendWebhook(TARGET_URL, SAMPLE_PAYLOAD);
    const [url] = mockSafeFetch.mock.calls[0];
    expect(url).toBe(TARGET_URL);
  });

  it("hands safeFetch the URL string unchanged, with no normalisation", async () => {
    const odd = "https://Hooks.Example.com:8443/a%20b/../c?x=1&y=%2F";
    await sendWebhook(odd, SAMPLE_PAYLOAD);
    expect(mockSafeFetch.mock.calls[0][0]).toBe(odd);
  });

  it("merges caller-supplied extra headers into the request", async () => {
    await sendWebhook(TARGET_URL, SAMPLE_PAYLOAD, {
      headers: { "X-Source": "test-runner", "Authorization": "Bearer tok" },
    });
    const [, init] = mockSafeFetch.mock.calls[0] as [string, SafeFetchInit & { headers: Record<string, string> }];
    expect(init.headers["X-Source"]).toBe("test-runner");
    expect(init.headers["Authorization"]).toBe("Bearer tok");
    // Built-in header must still be present
    expect(init.headers["Content-Type"]).toBe("application/json");
  });
});

describe("sendWebhook — error handling", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    globalThis.fetch = plainFetch as unknown as typeof fetch;
  });

  it("throws when the server responds with a non-ok status", async () => {
    mockSafeFetch.mockResolvedValueOnce({ ok: false, status: 500, statusText: "Internal Server Error" });
    await expect(sendWebhook(TARGET_URL, SAMPLE_PAYLOAD)).rejects.toThrow("Webhook failed: 500");
  });

  it("throws when the server responds with 404", async () => {
    mockSafeFetch.mockResolvedValueOnce({ ok: false, status: 404, statusText: "Not Found" });
    await expect(sendWebhook(TARGET_URL, SAMPLE_PAYLOAD)).rejects.toThrow("Webhook failed: 404");
  });

  it("throws a ChannelHttpError carrying the status and status text on a non-ok response", async () => {
    mockSafeFetch.mockResolvedValueOnce({ ok: false, status: 502, statusText: "Bad Gateway" });
    const err = await sendWebhook(TARGET_URL, SAMPLE_PAYLOAD).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ChannelHttpError);
    expect(err).toMatchObject({ status: 502, statusText: "Bad Gateway" });
  });

  it("treats a 3xx answer as a failed delivery and reports its status", async () => {
    mockSafeFetch.mockResolvedValueOnce({ ok: false, status: 302, statusText: "Found" });
    const err = await sendWebhook(TARGET_URL, SAMPLE_PAYLOAD).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ChannelHttpError);
    expect(err).toMatchObject({ status: 302, statusText: "Found" });
  });

  it("does not wrap a network failure in a ChannelHttpError", async () => {
    mockSafeFetch.mockRejectedValueOnce(new TypeError("fetch failed"));
    const err = await sendWebhook(TARGET_URL, SAMPLE_PAYLOAD).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TypeError);
    expect(err).not.toBeInstanceOf(ChannelHttpError);
  });

  it("makes a single safeFetch request for a non-ok answer (retries belong to the dispatcher)", async () => {
    mockSafeFetch.mockResolvedValueOnce({ ok: false, status: 500, statusText: "Internal Server Error" });
    await expect(sendWebhook(TARGET_URL, SAMPLE_PAYLOAD)).rejects.toBeInstanceOf(ChannelHttpError);
    expect(mockSafeFetch).toHaveBeenCalledOnce();
  });

  it("propagates network errors from safeFetch", async () => {
    mockSafeFetch.mockRejectedValueOnce(new Error("network timeout"));
    await expect(sendWebhook(TARGET_URL, SAMPLE_PAYLOAD)).rejects.toThrow("network timeout");
  });
});
