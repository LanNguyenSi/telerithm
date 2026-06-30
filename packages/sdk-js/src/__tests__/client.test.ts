import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { TelerithmClient } from "../client.js";
import { sendBatch } from "../transports/fetch.js";

vi.mock("../transports/fetch.js", () => ({
  sendBatch: vi.fn().mockResolvedValue(true),
}));

const BASE_OPTIONS = {
  dsn: "https://myapikey@ingester.example.com/source-abc",
  autoCapture: false,
  breadcrumbs: false,
  flushIntervalMs: 60_000,
} as const;

const mockSendBatch = vi.mocked(sendBatch);

// ---------------------------------------------------------------------------
// Constructor & parseDsn
// ---------------------------------------------------------------------------

describe("TelerithmClient — constructor", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("throws when neither dsn nor endpoint+apiKey is provided", () => {
    vi.useFakeTimers();
    expect(() => new TelerithmClient({})).toThrow(
      "Telerithm: provide either `dsn` or `endpoint` + `apiKey`",
    );
  });

  it("throws when only endpoint is given without apiKey", () => {
    vi.useFakeTimers();
    expect(() => new TelerithmClient({ endpoint: "https://example.com" })).toThrow();
  });

  it("throws on a malformed DSN", () => {
    vi.useFakeTimers();
    expect(() => new TelerithmClient({ dsn: "not-a-valid-url" })).toThrow();
  });
});

describe("TelerithmClient — parseDsn (tested via flush→sendBatch capture)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(async () => {
    vi.useRealTimers();
  });

  it("simple DSN: constructs exact endpoint and extracts apiKey from username", async () => {
    const c = new TelerithmClient({ ...BASE_OPTIONS });
    c.log("info", "ping");
    await c.flush();
    await c.close();

    expect(mockSendBatch).toHaveBeenCalledWith(
      expect.objectContaining({
        endpoint: "https://ingester.example.com/api/v1/ingest/source-abc",
        apiKey: "myapikey",
      }),
      expect.any(Object),
    );
  });

  it("DSN with explicit port: endpoint includes the port number", async () => {
    const c = new TelerithmClient({
      ...BASE_OPTIONS,
      dsn: "https://myapikey@ingester.example.com:8080/source-abc",
    });
    c.log("info", "ping");
    await c.flush();
    await c.close();

    expect(mockSendBatch).toHaveBeenCalledWith(
      expect.objectContaining({
        endpoint: "https://ingester.example.com:8080/api/v1/ingest/source-abc",
        apiKey: "myapikey",
      }),
      expect.any(Object),
    );
  });

  it("direct endpoint+apiKey+sourceId constructs the correct endpoint", async () => {
    const c = new TelerithmClient({
      endpoint: "https://ingester.example.com",
      apiKey: "direct-key",
      sourceId: "src-99",
      autoCapture: false,
      breadcrumbs: false,
      flushIntervalMs: 60_000,
    });
    c.log("info", "ping");
    await c.flush();
    await c.close();

    expect(mockSendBatch).toHaveBeenCalledWith(
      expect.objectContaining({
        endpoint: "https://ingester.example.com/api/v1/ingest/src-99",
        apiKey: "direct-key",
      }),
      expect.any(Object),
    );
  });

  it("direct endpoint+apiKey without sourceId appends empty segment", async () => {
    const c = new TelerithmClient({
      endpoint: "https://ingester.example.com",
      apiKey: "key",
      autoCapture: false,
      breadcrumbs: false,
      flushIntervalMs: 60_000,
    });
    c.log("info", "ping");
    await c.flush();
    await c.close();

    expect(mockSendBatch).toHaveBeenCalledWith(
      expect.objectContaining({
        endpoint: "https://ingester.example.com/api/v1/ingest/",
      }),
      expect.any(Object),
    );
  });
});

// ---------------------------------------------------------------------------
// log() — field merging, metadata, host, batchSize trigger
// ---------------------------------------------------------------------------

describe("TelerithmClient — log()", () => {
  let client: TelerithmClient;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    client = new TelerithmClient({ ...BASE_OPTIONS });
  });

  afterEach(async () => {
    await client.close();
    vi.useRealTimers();
  });

  it("tags WIN over extra when keys overlap (tags spread last)", async () => {
    client.setTag("env", "production");
    client.setTag("shared", "from-tag");
    client.log("info", "msg", { shared: "from-extra", only_in_extra: "yes" });
    await client.flush();

    const fields = mockSendBatch.mock.calls[0][1].logs[0].fields!;
    expect(fields["shared"]).toBe("from-tag"); // tags overwrite extra
    expect(fields["only_in_extra"]).toBe("yes");
    expect(fields["env"]).toBe("production");
  });

  it("attaches _release and _environment when options are set", async () => {
    const c = new TelerithmClient({ ...BASE_OPTIONS, release: "1.2.3", environment: "staging" });
    c.log("info", "msg");
    await c.flush();
    await c.close();

    const fields = mockSendBatch.mock.calls[0][1].logs[0].fields!;
    expect(fields["_release"]).toBe("1.2.3");
    expect(fields["_environment"]).toBe("staging");
  });

  it("does not attach _release/_environment when not set", async () => {
    client.log("info", "msg");
    await client.flush();

    const fields = mockSendBatch.mock.calls[0][1].logs[0].fields!;
    expect(fields["_release"]).toBeUndefined();
    expect(fields["_environment"]).toBeUndefined();
  });

  it("attaches _userId and _userEmail after setUser", async () => {
    client.setUser({ id: "u42", email: "user@example.com", name: "Alice" });
    client.log("info", "msg");
    await client.flush();

    const fields = mockSendBatch.mock.calls[0][1].logs[0].fields!;
    expect(fields["_userId"]).toBe("u42");
    expect(fields["_userEmail"]).toBe("user@example.com");
  });

  it("sets host to 'node' in a Node.js environment", async () => {
    client.log("info", "msg");
    await client.flush();

    const log = mockSendBatch.mock.calls[0][1].logs[0];
    expect(log.host).toBe("node");
  });

  it("sets host to window.location.hostname when window is defined", async () => {
    vi.stubGlobal("window", { location: { hostname: "my-app.example.com" } });
    client.log("info", "msg");
    vi.unstubAllGlobals();
    await client.flush();

    const log = mockSendBatch.mock.calls[0][1].logs[0];
    expect(log.host).toBe("my-app.example.com");
  });

  it("sets service from options", async () => {
    const c = new TelerithmClient({ ...BASE_OPTIONS, service: "my-service" });
    c.log("info", "msg");
    await c.flush();
    await c.close();

    const log = mockSendBatch.mock.calls[0][1].logs[0];
    expect(log.service).toBe("my-service");
  });

  it("passes the correct log level through", async () => {
    client.log("fatal", "msg");
    await client.flush();
    expect(mockSendBatch.mock.calls[0][1].logs[0].level).toBe("fatal");
  });

  it("auto-flushes synchronously when queue reaches batchSize", () => {
    const c = new TelerithmClient({ ...BASE_OPTIONS, batchSize: 2 });
    c.log("info", "first");
    expect(mockSendBatch).not.toHaveBeenCalled(); // not yet at batchSize
    c.log("info", "second"); // hits batchSize=2 → triggers flush()
    // sendBatch is invoked synchronously (before the await inside flush resolves)
    expect(mockSendBatch).toHaveBeenCalledOnce();
    // close without await — fake timers, sendBatch already stubbed
    void c.close();
  });

  it("convenience shorthand: debug() logs at debug level", async () => {
    client.debug("dbg msg");
    await client.flush();
    expect(mockSendBatch.mock.calls[0][1].logs[0].level).toBe("debug");
  });

  it("convenience shorthand: info() logs at info level", async () => {
    client.info("info msg");
    await client.flush();
    expect(mockSendBatch.mock.calls[0][1].logs[0].level).toBe("info");
  });

  it("convenience shorthand: warn() logs at warn level", async () => {
    client.warn("warn msg");
    await client.flush();
    expect(mockSendBatch.mock.calls[0][1].logs[0].level).toBe("warn");
  });

  it("convenience shorthand: error() logs at error level", async () => {
    client.error("err msg");
    await client.flush();
    expect(mockSendBatch.mock.calls[0][1].logs[0].level).toBe("error");
  });
});

// ---------------------------------------------------------------------------
// captureError()
// ---------------------------------------------------------------------------

describe("TelerithmClient — captureError()", () => {
  let client: TelerithmClient;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    client = new TelerithmClient({ ...BASE_OPTIONS });
  });

  afterEach(async () => {
    await client.close();
    vi.useRealTimers();
  });

  it("sets _errorName from err.name", async () => {
    const err = new TypeError("bad type");
    client.captureError(err);
    await client.flush();

    const fields = mockSendBatch.mock.calls[0][1].logs[0].fields!;
    expect(fields["_errorName"]).toBe("TypeError");
  });

  it("sets _stack from err.stack", async () => {
    const err = new Error("with stack");
    client.captureError(err);
    await client.flush();

    const fields = mockSendBatch.mock.calls[0][1].logs[0].fields!;
    expect(fields["_stack"]).toBe(err.stack);
  });

  it("logs at 'error' level with the error message as the log message", async () => {
    const err = new Error("something failed");
    client.captureError(err);
    await client.flush();

    const log = mockSendBatch.mock.calls[0][1].logs[0];
    expect(log.level).toBe("error");
    expect(log.message).toBe("something failed");
  });

  it("merges extra fields alongside _errorName/_stack", async () => {
    const err = new Error("test");
    client.captureError(err, { requestId: "req-123" });
    await client.flush();

    const fields = mockSendBatch.mock.calls[0][1].logs[0].fields!;
    expect(fields["requestId"]).toBe("req-123");
    expect(fields["_errorName"]).toBe("Error");
  });

  it("attaches breadcrumbs as JSON string when tracker has crumbs", async () => {
    const c = new TelerithmClient({ ...BASE_OPTIONS, breadcrumbs: true });
    c.addBreadcrumb({ category: "nav", message: "clicked button" });
    c.captureError(new Error("oops"));
    await c.flush();
    await c.close();

    const fields = mockSendBatch.mock.calls[0][1].logs[0].fields!;
    expect(typeof fields["_breadcrumbs"]).toBe("string");
    const crumbs = JSON.parse(fields["_breadcrumbs"] as string) as Array<{ message: string }>;
    expect(crumbs[0].message).toBe("clicked button");
  });

  it("does not attach _breadcrumbs when there are no crumbs yet", async () => {
    const c = new TelerithmClient({ ...BASE_OPTIONS, breadcrumbs: true });
    c.captureError(new Error("empty crumbs"));
    await c.flush();
    await c.close();

    const fields = mockSendBatch.mock.calls[0][1].logs[0].fields!;
    expect(fields["_breadcrumbs"]).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// flush()
// ---------------------------------------------------------------------------

describe("TelerithmClient — flush()", () => {
  let client: TelerithmClient;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    client = new TelerithmClient({ ...BASE_OPTIONS });
  });

  afterEach(async () => {
    await client.close();
    vi.useRealTimers();
  });

  it("sends all queued events in one sendBatch call", async () => {
    client.log("info", "first");
    client.log("warn", "second");
    client.log("error", "third");
    await client.flush();

    expect(mockSendBatch).toHaveBeenCalledOnce();
    expect(mockSendBatch.mock.calls[0][1].logs).toHaveLength(3);
  });

  it("drains the queue — a second flush sends nothing", async () => {
    client.log("info", "msg");
    await client.flush(); // drains
    await client.flush(); // empty queue → no call

    expect(mockSendBatch).toHaveBeenCalledTimes(1);
  });

  it("does not call sendBatch when the queue is already empty", async () => {
    await client.flush();
    expect(mockSendBatch).not.toHaveBeenCalled();
  });

  it("events are batched into logs array with correct message order", async () => {
    client.log("info", "a");
    client.log("info", "b");
    await client.flush();

    const messages = mockSendBatch.mock.calls[0][1].logs.map((l) => l.message);
    expect(messages).toEqual(["a", "b"]);
  });
});

// ---------------------------------------------------------------------------
// close() — timer hygiene and final flush
// ---------------------------------------------------------------------------

describe("TelerithmClient — close()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("flushes remaining events on close", async () => {
    vi.useFakeTimers();
    const c = new TelerithmClient({ ...BASE_OPTIONS });
    c.log("info", "final-msg");
    await c.close();

    expect(mockSendBatch).toHaveBeenCalledOnce();
    expect(mockSendBatch.mock.calls[0][1].logs[0].message).toBe("final-msg");
  });

  it("clears the interval so the timer does not fire after close", async () => {
    vi.useFakeTimers();
    const c = new TelerithmClient({ ...BASE_OPTIONS, flushIntervalMs: 1000 });
    c.log("info", "before-close");
    await c.close();

    vi.clearAllMocks();
    vi.advanceTimersByTime(5000); // interval is cleared — should not fire
    await Promise.resolve();
    expect(mockSendBatch).not.toHaveBeenCalled();
  });
});
