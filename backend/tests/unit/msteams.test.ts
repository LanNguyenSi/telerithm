import { beforeEach, describe, expect, it, vi } from "vitest";
import { ChannelConfigError, ChannelHttpError } from "../../src/services/notification/channels/errors.js";

// vi.mock calls are hoisted above imports by vitest
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
import { sendMsTeamsMessage } from "../../src/services/notification/channels/msteams.js";

const mockSafeFetch = vi.mocked(safeFetch);

// The global fetch must never be used for a user URL: delivery goes through
// safeFetch, which pins the vetted address. Any call here is a regression.
const plainFetch = vi.fn();

const TEAMS_URL = "https://teams.webhook.office.com/webhookb2/abc123";

const SAMPLE_INCIDENT = {
  incidentId: "inc-001",
  ruleId: "rule-001",
  severity: "CRITICAL",
  status: "OPEN",
  message: "Error rate exceeded threshold",
  createdAt: "2024-01-15T10:00:00.000Z",
};

describe("sendMsTeamsMessage: delivery goes through safeFetch (SSRF guard)", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockSafeFetch.mockResolvedValue({ ok: true, status: 200, statusText: "OK" });
    globalThis.fetch = plainFetch as unknown as typeof fetch;
  });

  it("sends through safeFetch with the exact webhook URL, once per delivery", async () => {
    await sendMsTeamsMessage(TEAMS_URL, SAMPLE_INCIDENT);
    expect(mockSafeFetch).toHaveBeenCalledOnce();
    expect(mockSafeFetch.mock.calls[0][0]).toBe(TEAMS_URL);
  });

  it("never calls the global fetch for the user URL", async () => {
    await sendMsTeamsMessage(TEAMS_URL, SAMPLE_INCIDENT);
    expect(plainFetch).not.toHaveBeenCalled();
  });

  it("propagates a guard refusal from safeFetch unchanged", async () => {
    const refusal = new ChannelConfigError("Webhook host resolves to a blocked address range");
    mockSafeFetch.mockRejectedValueOnce(refusal);
    await expect(sendMsTeamsMessage(TEAMS_URL, SAMPLE_INCIDENT)).rejects.toBe(refusal);
    expect(plainFetch).not.toHaveBeenCalled();
  });
});

describe("sendMsTeamsMessage — HTTP request properties", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockSafeFetch.mockResolvedValue({ ok: true, status: 200, statusText: "OK" });
    globalThis.fetch = plainFetch as unknown as typeof fetch;
  });

  it("sends POST method", async () => {
    await sendMsTeamsMessage(TEAMS_URL, SAMPLE_INCIDENT);
    const [, init] = mockSafeFetch.mock.calls[0] as [string, SafeFetchInit];
    expect(init.method).toBe("POST");
  });

  it("sets Content-Type: application/json", async () => {
    await sendMsTeamsMessage(TEAMS_URL, SAMPLE_INCIDENT);
    const [, init] = mockSafeFetch.mock.calls[0] as [string, SafeFetchInit & { headers: Record<string, string> }];
    expect(init.headers["Content-Type"]).toBe("application/json");
  });

  it("passes the webhook URL as the first safeFetch argument", async () => {
    await sendMsTeamsMessage(TEAMS_URL, SAMPLE_INCIDENT);
    const [url] = mockSafeFetch.mock.calls[0];
    expect(url).toBe(TEAMS_URL);
  });

  it("hands safeFetch the URL string unchanged, with no normalisation", async () => {
    const odd = "https://Teams.Example.com:8443/a%20b/../c?x=1&y=%2F";
    await sendMsTeamsMessage(odd, SAMPLE_INCIDENT);
    expect(mockSafeFetch.mock.calls[0][0]).toBe(odd);
  });

  it("sends a body that includes the incident message", async () => {
    await sendMsTeamsMessage(TEAMS_URL, SAMPLE_INCIDENT);
    const [, init] = mockSafeFetch.mock.calls[0] as [string, SafeFetchInit & { body: string }];
    const body = JSON.parse(init.body);
    // Adaptive card wraps content in attachments
    expect(JSON.stringify(body)).toContain(SAMPLE_INCIDENT.message);
  });

  it("includes the incident ID in the body", async () => {
    await sendMsTeamsMessage(TEAMS_URL, SAMPLE_INCIDENT);
    const [, init] = mockSafeFetch.mock.calls[0] as [string, SafeFetchInit & { body: string }];
    const body = JSON.stringify(JSON.parse(init.body));
    expect(body).toContain(SAMPLE_INCIDENT.incidentId);
  });

  it("uses the MS Teams adaptive card message type", async () => {
    await sendMsTeamsMessage(TEAMS_URL, SAMPLE_INCIDENT);
    const [, init] = mockSafeFetch.mock.calls[0] as [string, SafeFetchInit & { body: string }];
    const body = JSON.parse(init.body) as { type: string };
    expect(body.type).toBe("message");
  });
});

describe("sendMsTeamsMessage — error handling", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    globalThis.fetch = plainFetch as unknown as typeof fetch;
  });

  it("throws when the server responds with a non-ok status", async () => {
    mockSafeFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
    });
    await expect(sendMsTeamsMessage(TEAMS_URL, SAMPLE_INCIDENT)).rejects.toThrow(
      "MS Teams webhook failed: 500",
    );
  });

  it("throws when the server responds with 400", async () => {
    mockSafeFetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      statusText: "Bad Request",
    });
    await expect(sendMsTeamsMessage(TEAMS_URL, SAMPLE_INCIDENT)).rejects.toThrow(
      "MS Teams webhook failed: 400",
    );
  });

  it("throws a ChannelHttpError carrying the status and status text on a non-ok response", async () => {
    mockSafeFetch.mockResolvedValueOnce({ ok: false, status: 503, statusText: "Service Unavailable" });
    const err = await sendMsTeamsMessage(TEAMS_URL, SAMPLE_INCIDENT).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ChannelHttpError);
    expect(err).toMatchObject({ status: 503, statusText: "Service Unavailable" });
  });

  it("treats a 3xx answer as a failed delivery and reports its status", async () => {
    mockSafeFetch.mockResolvedValueOnce({ ok: false, status: 302, statusText: "Found" });
    const err = await sendMsTeamsMessage(TEAMS_URL, SAMPLE_INCIDENT).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ChannelHttpError);
    expect(err).toMatchObject({ status: 302, statusText: "Found" });
  });

  it("does not wrap a network failure in a ChannelHttpError", async () => {
    mockSafeFetch.mockRejectedValueOnce(new TypeError("fetch failed"));
    const err = await sendMsTeamsMessage(TEAMS_URL, SAMPLE_INCIDENT).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TypeError);
    expect(err).not.toBeInstanceOf(ChannelHttpError);
  });

  it("makes a single safeFetch request for a non-ok answer (retries belong to the dispatcher)", async () => {
    mockSafeFetch.mockResolvedValueOnce({ ok: false, status: 500, statusText: "Internal Server Error" });
    await expect(sendMsTeamsMessage(TEAMS_URL, SAMPLE_INCIDENT)).rejects.toBeInstanceOf(ChannelHttpError);
    expect(mockSafeFetch).toHaveBeenCalledOnce();
  });

  it("propagates network errors from safeFetch", async () => {
    mockSafeFetch.mockRejectedValueOnce(new Error("network timeout"));
    await expect(sendMsTeamsMessage(TEAMS_URL, SAMPLE_INCIDENT)).rejects.toThrow("network timeout");
  });

  it("does not throw when response is ok", async () => {
    mockSafeFetch.mockResolvedValueOnce({ ok: true, status: 200, statusText: "OK" });
    await expect(sendMsTeamsMessage(TEAMS_URL, SAMPLE_INCIDENT)).resolves.toBeUndefined();
  });
});
