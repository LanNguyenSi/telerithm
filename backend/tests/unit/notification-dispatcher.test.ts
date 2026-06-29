import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// vi.hoisted lets these be referenced safely inside vi.mock() factory functions
// (vi.mock() calls are hoisted above imports; vi.hoisted() runs before them).
const {
  mockFindForIncident,
  mockSendWebhook,
  mockSendEmail,
  mockSendMsTeamsMessage,
  mockAssertSafeUrl,
} = vi.hoisted(() => ({
  mockFindForIncident: vi.fn(),
  mockSendWebhook: vi.fn(),
  mockSendEmail: vi.fn(),
  mockSendMsTeamsMessage: vi.fn(),
  mockAssertSafeUrl: vi.fn(),
}));

// Use a class-form mock so that vi.resetAllMocks() does not clear the SubscriptionService
// constructor mock implementation — resetAllMocks resets vi.fn() implementations but not
// class definitions. The instance property directly references the hoisted mock fn.
vi.mock("../../src/services/subscription/subscription-service.js", () => ({
  SubscriptionService: class {
    findForIncident = mockFindForIncident;
  },
}));

vi.mock("../../src/services/notification/channels/webhook.js", () => ({
  sendWebhook: mockSendWebhook,
}));

vi.mock("../../src/services/notification/channels/email.js", () => ({
  sendEmail: mockSendEmail,
}));

vi.mock("../../src/services/notification/channels/msteams.js", () => ({
  sendMsTeamsMessage: mockSendMsTeamsMessage,
}));

vi.mock("../../src/services/notification/url-guard.js", () => ({
  assertSafeUrl: mockAssertSafeUrl,
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

import { NotificationDispatcher } from "../../src/services/notification/notification-dispatcher.js";

// ---------------------------------------------------------------------------
// Shared test fixtures
// ---------------------------------------------------------------------------

const INCIDENT = {
  id: "inc-001",
  ruleId: "rule-001",
  teamId: "team-001",
  severity: "CRITICAL",
  status: "OPEN",
  message: "Error rate exceeded threshold",
  createdAt: "2024-01-15T10:00:00.000Z",
};

function makeWebhookSubscriber(overrides: Record<string, unknown> = {}) {
  return {
    id: "sub-webhook",
    channel: "WEBHOOK",
    config: { url: "https://hooks.example.com/webhook", secret: "s3cr3t" },
    user: { id: "user-1", email: "user@example.com", name: "Test User" },
    ...overrides,
  };
}

function makeEmailSubscriber(overrides: Record<string, unknown> = {}) {
  return {
    id: "sub-email",
    channel: "EMAIL",
    config: { email: "alert@example.com" },
    user: { id: "user-2", email: "user2@example.com", name: "Email User" },
    ...overrides,
  };
}

function makeMsTeamsSubscriber(overrides: Record<string, unknown> = {}) {
  return {
    id: "sub-msteams",
    channel: "MSTEAMS",
    config: { webhook_url: "https://teams.webhook.office.com/webhookb2/abc" },
    user: { id: "user-3", email: "user3@example.com", name: "Teams User" },
    ...overrides,
  };
}

function makeSlackSubscriber(overrides: Record<string, unknown> = {}) {
  return {
    id: "sub-slack",
    channel: "SLACK",
    config: { webhook_url: "https://hooks.slack.com/services/abc/def" },
    user: { id: "user-4", email: "user4@example.com", name: "Slack User" },
    ...overrides,
  };
}

const mockFetch = vi.fn();

// ---------------------------------------------------------------------------
// Channel routing
// ---------------------------------------------------------------------------

describe("NotificationDispatcher.dispatch — channel routing", () => {
  let dispatcher: NotificationDispatcher;

  beforeEach(() => {
    vi.resetAllMocks();
    dispatcher = new NotificationDispatcher();
    globalThis.fetch = mockFetch;
  });

  it("routes WEBHOOK channel to sendWebhook", async () => {
    mockFindForIncident.mockResolvedValue([makeWebhookSubscriber()]);
    mockSendWebhook.mockResolvedValue(undefined);

    await dispatcher.dispatch(INCIDENT);

    expect(mockSendWebhook).toHaveBeenCalledOnce();
    expect(mockSendWebhook).toHaveBeenCalledWith(
      "https://hooks.example.com/webhook",
      expect.objectContaining({ incidentId: INCIDENT.id }),
      expect.objectContaining({ secret: "s3cr3t" }),
    );
  });

  it("routes EMAIL channel to sendEmail", async () => {
    mockFindForIncident.mockResolvedValue([makeEmailSubscriber()]);
    mockSendEmail.mockResolvedValue(undefined);

    await dispatcher.dispatch(INCIDENT);

    expect(mockSendEmail).toHaveBeenCalledOnce();
    expect(mockSendEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: "alert@example.com" }),
    );
  });

  it("falls back to user email when EMAIL config has no dedicated email field", async () => {
    mockFindForIncident.mockResolvedValue([
      makeEmailSubscriber({ config: {} }),
    ]);
    mockSendEmail.mockResolvedValue(undefined);

    await dispatcher.dispatch(INCIDENT);

    expect(mockSendEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: "user2@example.com" }),
    );
  });

  it("routes MSTEAMS channel to sendMsTeamsMessage", async () => {
    mockFindForIncident.mockResolvedValue([makeMsTeamsSubscriber()]);
    mockSendMsTeamsMessage.mockResolvedValue(undefined);

    await dispatcher.dispatch(INCIDENT);

    expect(mockSendMsTeamsMessage).toHaveBeenCalledOnce();
    expect(mockSendMsTeamsMessage).toHaveBeenCalledWith(
      "https://teams.webhook.office.com/webhookb2/abc",
      expect.objectContaining({ incidentId: INCIDENT.id }),
    );
  });

  it("routes SLACK channel to the internal sendSlackMessage (which calls fetch)", async () => {
    mockAssertSafeUrl.mockResolvedValue(undefined);
    mockFetch.mockResolvedValue({ ok: true, status: 200 } as Response);
    mockFindForIncident.mockResolvedValue([makeSlackSubscriber()]);

    await dispatcher.dispatch(INCIDENT);

    expect(mockFetch).toHaveBeenCalledOnce();
    expect(mockFetch).toHaveBeenCalledWith(
      "https://hooks.slack.com/services/abc/def",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("does NOT call sendWebhook for non-WEBHOOK channels", async () => {
    mockFindForIncident.mockResolvedValue([makeEmailSubscriber()]);
    mockSendEmail.mockResolvedValue(undefined);

    await dispatcher.dispatch(INCIDENT);

    expect(mockSendWebhook).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// SLACK SSRF guard (call-order)
// ---------------------------------------------------------------------------

describe("NotificationDispatcher.dispatch — SLACK SSRF guard", () => {
  let dispatcher: NotificationDispatcher;
  const callOrder: string[] = [];

  beforeEach(() => {
    vi.resetAllMocks();
    // Fake timers so the SSRF-reject path's retry backoff does not sleep on the
    // real clock; the success-path tests resolve on the first attempt (no timer).
    vi.useFakeTimers();
    callOrder.length = 0;
    dispatcher = new NotificationDispatcher();

    mockAssertSafeUrl.mockImplementation(async () => {
      callOrder.push("assertSafeUrl");
    });

    mockFetch.mockImplementation(async () => {
      callOrder.push("fetch");
      return { ok: true, status: 200 } as Response;
    });
    globalThis.fetch = mockFetch;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("calls assertSafeUrl before fetch for SLACK channel", async () => {
    mockFindForIncident.mockResolvedValue([makeSlackSubscriber()]);

    await dispatcher.dispatch(INCIDENT);

    expect(callOrder).toEqual(["assertSafeUrl", "fetch"]);
  });

  it("calls assertSafeUrl with the Slack webhook URL", async () => {
    mockFindForIncident.mockResolvedValue([makeSlackSubscriber()]);

    await dispatcher.dispatch(INCIDENT);

    expect(mockAssertSafeUrl).toHaveBeenCalledWith(
      "https://hooks.slack.com/services/abc/def",
    );
  });

  it("prevents fetch when assertSafeUrl rejects for SLACK (SSRF block)", async () => {
    mockAssertSafeUrl.mockRejectedValue(new Error("Host resolves to blocked range"));
    mockFindForIncident.mockResolvedValue([makeSlackSubscriber()]);

    // dispatch() swallows per-channel errors; it resolves even though the channel failed
    const dispatchPromise = dispatcher.dispatch(INCIDENT);
    await vi.runAllTimersAsync();
    await dispatchPromise;

    // assertSafeUrl was called but fetch was never reached
    expect(mockAssertSafeUrl).toHaveBeenCalled();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("SLACK request uses POST method", async () => {
    mockFindForIncident.mockResolvedValue([makeSlackSubscriber()]);

    await dispatcher.dispatch(INCIDENT);

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe("POST");
  });

  it("SLACK request uses redirect: manual", async () => {
    mockFindForIncident.mockResolvedValue([makeSlackSubscriber()]);

    await dispatcher.dispatch(INCIDENT);

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(init.redirect).toBe("manual");
  });
});

// ---------------------------------------------------------------------------
// Early return on empty subscribers
// ---------------------------------------------------------------------------

describe("NotificationDispatcher.dispatch — empty subscribers", () => {
  let dispatcher: NotificationDispatcher;

  beforeEach(() => {
    vi.resetAllMocks();
    dispatcher = new NotificationDispatcher();
    globalThis.fetch = mockFetch;
  });

  it("returns early without calling any channel when subscriber list is empty", async () => {
    mockFindForIncident.mockResolvedValue([]);

    await dispatcher.dispatch(INCIDENT);

    expect(mockSendWebhook).not.toHaveBeenCalled();
    expect(mockSendEmail).not.toHaveBeenCalled();
    expect(mockSendMsTeamsMessage).not.toHaveBeenCalled();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("resolves without throwing when subscribers list is empty", async () => {
    mockFindForIncident.mockResolvedValue([]);

    await expect(dispatcher.dispatch(INCIDENT)).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Per-channel error swallowing
// ---------------------------------------------------------------------------

describe("NotificationDispatcher.dispatch — per-channel error swallowing", () => {
  let dispatcher: NotificationDispatcher;

  beforeEach(() => {
    vi.resetAllMocks();
    // Fake timers so the exponential backoff between retries does not sleep
    // on the real clock (the failing-webhook paths exhaust all 3 attempts).
    vi.useFakeTimers();
    dispatcher = new NotificationDispatcher();
    globalThis.fetch = mockFetch;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("swallows errors from a failing channel so dispatch always resolves", async () => {
    mockFindForIncident.mockResolvedValue([makeWebhookSubscriber()]);
    // Fail on every attempt so all 3 retries exhaust
    mockSendWebhook.mockRejectedValue(new Error("delivery failure"));

    const dispatchPromise = dispatcher.dispatch(INCIDENT);
    await vi.runAllTimersAsync();
    await expect(dispatchPromise).resolves.toBeUndefined();
  });

  it("still delivers to healthy channels when one channel throws", async () => {
    mockFindForIncident.mockResolvedValue([
      makeWebhookSubscriber(),
      makeEmailSubscriber(),
    ]);
    mockSendWebhook.mockRejectedValue(new Error("webhook down"));
    mockSendEmail.mockResolvedValue(undefined);

    const dispatchPromise = dispatcher.dispatch(INCIDENT);
    await vi.runAllTimersAsync();
    await dispatchPromise;

    // Email should still have been delivered
    expect(mockSendEmail).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// Retry logic
// ---------------------------------------------------------------------------

describe("NotificationDispatcher.dispatch — retry logic", () => {
  let dispatcher: NotificationDispatcher;

  beforeEach(() => {
    vi.resetAllMocks();
    vi.useFakeTimers();
    dispatcher = new NotificationDispatcher();
    globalThis.fetch = mockFetch;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("retries up to MAX_RETRIES (3) times when channel keeps failing", async () => {
    mockFindForIncident.mockResolvedValue([makeWebhookSubscriber()]);
    mockSendWebhook.mockRejectedValue(new Error("transient error"));

    const dispatchPromise = dispatcher.dispatch(INCIDENT);
    await vi.runAllTimersAsync();
    await dispatchPromise;

    // 3 attempts total (initial + 2 retries)
    expect(mockSendWebhook).toHaveBeenCalledTimes(3);
  });

  it("succeeds without further retries on the second attempt", async () => {
    mockFindForIncident.mockResolvedValue([makeWebhookSubscriber()]);
    mockSendWebhook
      .mockRejectedValueOnce(new Error("first attempt fails"))
      .mockResolvedValueOnce(undefined);

    const dispatchPromise = dispatcher.dispatch(INCIDENT);
    await vi.runAllTimersAsync();
    await dispatchPromise;

    expect(mockSendWebhook).toHaveBeenCalledTimes(2);
  });

  it("uses exponential backoff: first delay is 2^1 * 500 = 1000 ms", async () => {
    mockFindForIncident.mockResolvedValue([makeWebhookSubscriber()]);
    // Fail first attempt, succeed on second
    mockSendWebhook
      .mockRejectedValueOnce(new Error("fail"))
      .mockResolvedValueOnce(undefined);

    const dispatchPromise = dispatcher.dispatch(INCIDENT);

    // Advance by less than the backoff → not yet retried
    await vi.advanceTimersByTimeAsync(999);
    expect(mockSendWebhook).toHaveBeenCalledTimes(1);

    // Advance past the 1000 ms backoff → retry fires
    await vi.advanceTimersByTimeAsync(2);
    await dispatchPromise;
    expect(mockSendWebhook).toHaveBeenCalledTimes(2);
  });

  it("applies a longer delay for the second retry: 2^2 * 500 = 2000 ms", async () => {
    mockFindForIncident.mockResolvedValue([makeWebhookSubscriber()]);
    // Fail first two, succeed on third
    mockSendWebhook
      .mockRejectedValueOnce(new Error("fail 1"))
      .mockRejectedValueOnce(new Error("fail 2"))
      .mockResolvedValueOnce(undefined);

    const dispatchPromise = dispatcher.dispatch(INCIDENT);

    // Past first backoff (1000 ms) — second attempt fires
    await vi.advanceTimersByTimeAsync(1001);
    expect(mockSendWebhook).toHaveBeenCalledTimes(2);

    // Only 500 ms into the second backoff — third attempt has NOT fired yet
    await vi.advanceTimersByTimeAsync(500);
    expect(mockSendWebhook).toHaveBeenCalledTimes(2);

    // Past the second backoff (2000 ms total) — third attempt fires
    await vi.advanceTimersByTimeAsync(1500);
    await dispatchPromise;
    expect(mockSendWebhook).toHaveBeenCalledTimes(3);
  });
});
