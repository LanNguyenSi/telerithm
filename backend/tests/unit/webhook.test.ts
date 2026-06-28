import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";

// vi.mock calls are hoisted to the top of the file by vitest —
// they must appear before any imports that reference the mocked modules.
vi.mock("../../src/services/notification/url-guard.js", () => ({
  assertSafeUrl: vi.fn(),
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

import { assertSafeUrl } from "../../src/services/notification/url-guard.js";
import { sendWebhook, type WebhookPayload } from "../../src/services/notification/channels/webhook.js";

const mockAssertSafeUrl = vi.mocked(assertSafeUrl);

// Shared mock for global fetch
const mockFetch = vi.fn();

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
    mockAssertSafeUrl.mockResolvedValue(undefined);

    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
    } as Response);
    globalThis.fetch = mockFetch;
  });

  it("adds X-Telerithm-Signature header with correct HMAC-SHA256 when secret is provided", async () => {
    const secret = "webhook-signing-secret";
    await sendWebhook(TARGET_URL, SAMPLE_PAYLOAD, { secret });

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit & { headers: Record<string, string> }];
    const body = JSON.stringify(SAMPLE_PAYLOAD);
    const expectedSig = "sha256=" + createHmac("sha256", secret).update(body).digest("hex");

    expect(init.headers["X-Telerithm-Signature"]).toBe(expectedSig);
  });

  it("HMAC covers the exact serialized JSON body (no deviation)", async () => {
    const secret = "s3cr3t";
    await sendWebhook(TARGET_URL, SAMPLE_PAYLOAD, { secret });

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit & { body: string; headers: Record<string, string> }];
    // The body actually sent and the HMAC input must match
    const body = init.body as string;
    const expectedSig = "sha256=" + createHmac("sha256", secret).update(body).digest("hex");

    expect(init.headers["X-Telerithm-Signature"]).toBe(expectedSig);
  });

  it("omits X-Telerithm-Signature when no secret is provided", async () => {
    await sendWebhook(TARGET_URL, SAMPLE_PAYLOAD);

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit & { headers: Record<string, string> }];
    expect(init.headers["X-Telerithm-Signature"]).toBeUndefined();
  });

  it("omits X-Telerithm-Signature when options object is provided but has no secret", async () => {
    await sendWebhook(TARGET_URL, SAMPLE_PAYLOAD, { headers: { "X-Custom": "val" } });

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit & { headers: Record<string, string> }];
    expect(init.headers["X-Telerithm-Signature"]).toBeUndefined();
  });
});

describe("sendWebhook — assertSafeUrl invocation (SSRF guard)", () => {
  // Track call order to assert assertSafeUrl is called BEFORE fetch
  const callOrder: string[] = [];

  beforeEach(() => {
    vi.resetAllMocks();
    callOrder.length = 0;

    mockAssertSafeUrl.mockImplementation(async () => {
      callOrder.push("assertSafeUrl");
    });

    mockFetch.mockImplementation(async () => {
      callOrder.push("fetch");
      return { ok: true, status: 200, statusText: "OK" } as Response;
    });
    globalThis.fetch = mockFetch;
  });

  it("calls assertSafeUrl before fetch", async () => {
    await sendWebhook(TARGET_URL, SAMPLE_PAYLOAD);
    expect(callOrder).toEqual(["assertSafeUrl", "fetch"]);
  });

  it("calls assertSafeUrl with the exact target URL", async () => {
    await sendWebhook(TARGET_URL, SAMPLE_PAYLOAD);
    expect(mockAssertSafeUrl).toHaveBeenCalledWith(TARGET_URL);
  });

  it("calls assertSafeUrl exactly once per delivery", async () => {
    await sendWebhook(TARGET_URL, SAMPLE_PAYLOAD);
    expect(mockAssertSafeUrl).toHaveBeenCalledOnce();
  });

  it("does NOT call fetch when assertSafeUrl rejects (SSRF guard blocks delivery)", async () => {
    mockAssertSafeUrl.mockRejectedValueOnce(
      new Error("Webhook host resolves to a blocked address range"),
    );
    await expect(sendWebhook(TARGET_URL, SAMPLE_PAYLOAD)).rejects.toThrow("blocked address range");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("propagates the exact error thrown by assertSafeUrl", async () => {
    mockAssertSafeUrl.mockRejectedValueOnce(new Error("Webhook host is not in the allow-list"));
    await expect(sendWebhook(TARGET_URL, SAMPLE_PAYLOAD)).rejects.toThrow(
      "Webhook host is not in the allow-list",
    );
  });
});

describe("sendWebhook — HTTP request properties", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockAssertSafeUrl.mockResolvedValue(undefined);
    mockFetch.mockResolvedValue({ ok: true, status: 200, statusText: "OK" } as Response);
    globalThis.fetch = mockFetch;
  });

  it("sends POST method", async () => {
    await sendWebhook(TARGET_URL, SAMPLE_PAYLOAD);
    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe("POST");
  });

  it("sends the payload serialized as JSON body", async () => {
    await sendWebhook(TARGET_URL, SAMPLE_PAYLOAD);
    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit & { body: string }];
    expect(JSON.parse(init.body)).toEqual(SAMPLE_PAYLOAD);
  });

  it("sets Content-Type: application/json", async () => {
    await sendWebhook(TARGET_URL, SAMPLE_PAYLOAD);
    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit & { headers: Record<string, string> }];
    expect(init.headers["Content-Type"]).toBe("application/json");
  });

  it("sets redirect: manual to prevent redirect-based SSRF bypass", async () => {
    await sendWebhook(TARGET_URL, SAMPLE_PAYLOAD);
    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(init.redirect).toBe("manual");
  });

  it("passes the target URL as the first fetch argument", async () => {
    await sendWebhook(TARGET_URL, SAMPLE_PAYLOAD);
    const [url] = mockFetch.mock.calls[0] as [string];
    expect(url).toBe(TARGET_URL);
  });

  it("merges caller-supplied extra headers into the request", async () => {
    await sendWebhook(TARGET_URL, SAMPLE_PAYLOAD, {
      headers: { "X-Source": "test-runner", "Authorization": "Bearer tok" },
    });
    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit & { headers: Record<string, string> }];
    expect(init.headers["X-Source"]).toBe("test-runner");
    expect(init.headers["Authorization"]).toBe("Bearer tok");
    // Built-in header must still be present
    expect(init.headers["Content-Type"]).toBe("application/json");
  });
});

describe("sendWebhook — error handling", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockAssertSafeUrl.mockResolvedValue(undefined);
    globalThis.fetch = mockFetch;
  });

  it("throws when the server responds with a non-ok status", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500, statusText: "Internal Server Error" } as Response);
    await expect(sendWebhook(TARGET_URL, SAMPLE_PAYLOAD)).rejects.toThrow("Webhook failed: 500");
  });

  it("throws when the server responds with 404", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 404, statusText: "Not Found" } as Response);
    await expect(sendWebhook(TARGET_URL, SAMPLE_PAYLOAD)).rejects.toThrow("Webhook failed: 404");
  });

  it("propagates network errors from fetch", async () => {
    mockFetch.mockRejectedValueOnce(new Error("network timeout"));
    await expect(sendWebhook(TARGET_URL, SAMPLE_PAYLOAD)).rejects.toThrow("network timeout");
  });
});
