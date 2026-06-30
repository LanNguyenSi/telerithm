import { describe, it, expect, afterEach, vi } from "vitest";
import { sendBatch } from "../transports/fetch.js";
import type { TransportConfig, LogPayload } from "../transports/fetch.js";

const ENDPOINT = "https://example.com/api/v1/ingest/src123";
const API_KEY = "test-api-key";
const TRANSPORT: TransportConfig = { endpoint: ENDPOINT, apiKey: API_KEY };

const PAYLOAD: LogPayload = {
  logs: [{ timestamp: "2024-01-01T00:00:00.000Z", level: "info", message: "hello" }],
};

describe("sendBatch", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("POSTs to the endpoint with correct headers and body, returns true on ok", async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", mockFetch);

    const result = await sendBatch(TRANSPORT, PAYLOAD);

    expect(result).toBe(true);
    expect(mockFetch).toHaveBeenCalledOnce();

    const [url, options] = mockFetch.mock.calls[0] as [string, RequestInit & { headers: Record<string, string> }];
    expect(url).toBe(ENDPOINT);
    expect(options.method).toBe("POST");
    expect(options.headers["X-API-Key"]).toBe(API_KEY);
    expect(options.headers["Content-Type"]).toBe("application/json");
    expect(JSON.parse(options.body as string)).toEqual(PAYLOAD);
  });

  it("returns false when response.ok is false (non-2xx)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));
    const result = await sendBatch(TRANSPORT, PAYLOAD);
    expect(result).toBe(false);
  });

  it("returns false on network error (fetch rejects)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Network failure")));
    const result = await sendBatch(TRANSPORT, PAYLOAD);
    expect(result).toBe(false);
  });

  it("returns false on AbortError (request timeout)", async () => {
    const abortError = new DOMException("The operation was aborted", "AbortError");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(abortError));
    const result = await sendBatch(TRANSPORT, PAYLOAD);
    expect(result).toBe(false);
  });

  it("passes the configured timeout value to AbortSignal.timeout", async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", mockFetch);
    const timeoutSpy = vi.spyOn(AbortSignal, "timeout");

    await sendBatch({ ...TRANSPORT, timeout: 3000 }, PAYLOAD);

    // The exact value must reach AbortSignal.timeout — not just "a signal exists".
    expect(timeoutSpy).toHaveBeenCalledWith(3000);
    const [, options] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(options.signal).toBeDefined();
  });

  it("defaults to a 10 000 ms timeout when none is configured", async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", mockFetch);
    const timeoutSpy = vi.spyOn(AbortSignal, "timeout");

    await sendBatch(TRANSPORT, PAYLOAD); // timeout omitted

    // Pins the documented default; breaking `?? 10_000` must fail this test.
    expect(timeoutSpy).toHaveBeenCalledWith(10_000);
  });
});
