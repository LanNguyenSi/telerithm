import { beforeEach, describe, expect, it, vi } from "vitest";

// vi.mock calls are hoisted above imports by vitest
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
import { sendMsTeamsMessage } from "../../src/services/notification/channels/msteams.js";

const mockAssertSafeUrl = vi.mocked(assertSafeUrl);
const mockFetch = vi.fn();

const TEAMS_URL = "https://teams.webhook.office.com/webhookb2/abc123";

const SAMPLE_INCIDENT = {
  incidentId: "inc-001",
  ruleId: "rule-001",
  severity: "CRITICAL",
  status: "OPEN",
  message: "Error rate exceeded threshold",
  createdAt: "2024-01-15T10:00:00.000Z",
};

describe("sendMsTeamsMessage — assertSafeUrl call-order (SSRF guard)", () => {
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
    await sendMsTeamsMessage(TEAMS_URL, SAMPLE_INCIDENT);
    expect(callOrder).toEqual(["assertSafeUrl", "fetch"]);
  });

  it("calls assertSafeUrl with the exact webhook URL", async () => {
    await sendMsTeamsMessage(TEAMS_URL, SAMPLE_INCIDENT);
    expect(mockAssertSafeUrl).toHaveBeenCalledWith(TEAMS_URL);
  });

  it("calls assertSafeUrl exactly once per delivery", async () => {
    await sendMsTeamsMessage(TEAMS_URL, SAMPLE_INCIDENT);
    expect(mockAssertSafeUrl).toHaveBeenCalledOnce();
  });

  it("does NOT call fetch when assertSafeUrl rejects (SSRF guard blocks delivery)", async () => {
    mockAssertSafeUrl.mockRejectedValueOnce(
      new Error("MS Teams host resolves to a blocked address range"),
    );
    await expect(sendMsTeamsMessage(TEAMS_URL, SAMPLE_INCIDENT)).rejects.toThrow(
      "blocked address range",
    );
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("propagates the exact error thrown by assertSafeUrl", async () => {
    mockAssertSafeUrl.mockRejectedValueOnce(new Error("Host is on the deny list"));
    await expect(sendMsTeamsMessage(TEAMS_URL, SAMPLE_INCIDENT)).rejects.toThrow(
      "Host is on the deny list",
    );
  });
});

describe("sendMsTeamsMessage — HTTP request properties", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockAssertSafeUrl.mockResolvedValue(undefined);
    mockFetch.mockResolvedValue({ ok: true, status: 200, statusText: "OK" } as Response);
    globalThis.fetch = mockFetch;
  });

  it("sends POST method", async () => {
    await sendMsTeamsMessage(TEAMS_URL, SAMPLE_INCIDENT);
    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe("POST");
  });

  it("sets Content-Type: application/json", async () => {
    await sendMsTeamsMessage(TEAMS_URL, SAMPLE_INCIDENT);
    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit & { headers: Record<string, string> }];
    expect(init.headers["Content-Type"]).toBe("application/json");
  });

  it("sets redirect: manual to prevent redirect-based SSRF bypass", async () => {
    await sendMsTeamsMessage(TEAMS_URL, SAMPLE_INCIDENT);
    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(init.redirect).toBe("manual");
  });

  it("sets AbortSignal timeout on the request", async () => {
    await sendMsTeamsMessage(TEAMS_URL, SAMPLE_INCIDENT);
    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("passes the webhook URL as the first fetch argument", async () => {
    await sendMsTeamsMessage(TEAMS_URL, SAMPLE_INCIDENT);
    const [url] = mockFetch.mock.calls[0] as [string];
    expect(url).toBe(TEAMS_URL);
  });

  it("sends a body that includes the incident message", async () => {
    await sendMsTeamsMessage(TEAMS_URL, SAMPLE_INCIDENT);
    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit & { body: string }];
    const body = JSON.parse(init.body);
    // Adaptive card wraps content in attachments
    expect(JSON.stringify(body)).toContain(SAMPLE_INCIDENT.message);
  });

  it("includes the incident ID in the body", async () => {
    await sendMsTeamsMessage(TEAMS_URL, SAMPLE_INCIDENT);
    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit & { body: string }];
    const body = JSON.stringify(JSON.parse(init.body));
    expect(body).toContain(SAMPLE_INCIDENT.incidentId);
  });

  it("uses the MS Teams adaptive card message type", async () => {
    await sendMsTeamsMessage(TEAMS_URL, SAMPLE_INCIDENT);
    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit & { body: string }];
    const body = JSON.parse(init.body) as { type: string };
    expect(body.type).toBe("message");
  });
});

describe("sendMsTeamsMessage — error handling", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockAssertSafeUrl.mockResolvedValue(undefined);
    globalThis.fetch = mockFetch;
  });

  it("throws when the server responds with a non-ok status", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
    } as Response);
    await expect(sendMsTeamsMessage(TEAMS_URL, SAMPLE_INCIDENT)).rejects.toThrow(
      "MS Teams webhook failed: 500",
    );
  });

  it("throws when the server responds with 400", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      statusText: "Bad Request",
    } as Response);
    await expect(sendMsTeamsMessage(TEAMS_URL, SAMPLE_INCIDENT)).rejects.toThrow(
      "MS Teams webhook failed: 400",
    );
  });

  it("propagates network errors from fetch", async () => {
    mockFetch.mockRejectedValueOnce(new Error("network timeout"));
    await expect(sendMsTeamsMessage(TEAMS_URL, SAMPLE_INCIDENT)).rejects.toThrow("network timeout");
  });

  it("does not throw when response is ok", async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, status: 200, statusText: "OK" } as Response);
    await expect(sendMsTeamsMessage(TEAMS_URL, SAMPLE_INCIDENT)).resolves.toBeUndefined();
  });
});
