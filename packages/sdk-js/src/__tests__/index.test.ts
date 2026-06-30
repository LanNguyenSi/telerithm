import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as Sdk from "../index.js";
import { TelerithmClient } from "../client.js";

vi.mock("../transports/fetch.js", () => ({
  sendBatch: vi.fn().mockResolvedValue(true),
}));

const DSN_A = "https://keyA@example.com/srcA";
const DSN_B = "https://keyB@example.com/srcB";
const BASE = { autoCapture: false, breadcrumbs: false, flushIntervalMs: 60_000 } as const;

// ---------------------------------------------------------------------------
// Singleton lifecycle
// ---------------------------------------------------------------------------

describe("Singleton — init / getClient / close", () => {
  beforeEach(async () => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    await Sdk.close(); // guarantee null baseline
  });

  afterEach(async () => {
    await Sdk.close();
    vi.useRealTimers();
  });

  it("getClient() returns null before any init", () => {
    expect(Sdk.getClient()).toBeNull();
  });

  it("init() returns a TelerithmClient", () => {
    const client = Sdk.init({ dsn: DSN_A, ...BASE });
    expect(client).toBeInstanceOf(TelerithmClient);
  });

  it("getClient() returns the client set by init()", () => {
    const client = Sdk.init({ dsn: DSN_A, ...BASE });
    expect(Sdk.getClient()).toBe(client);
  });

  it("close() nulls the client — getClient returns null afterward", async () => {
    Sdk.init({ dsn: DSN_A, ...BASE });
    await Sdk.close();
    expect(Sdk.getClient()).toBeNull();
  });

  it("double init() calls close() on the previous client before replacing", () => {
    const first = Sdk.init({ dsn: DSN_A, ...BASE });
    const closeSpy = vi.spyOn(first, "close");

    Sdk.init({ dsn: DSN_B, ...BASE }); // triggers first.close()
    expect(closeSpy).toHaveBeenCalledOnce();
  });

  it("double init() replaces the client — getClient returns the new one", () => {
    const first = Sdk.init({ dsn: DSN_A, ...BASE });
    const second = Sdk.init({ dsn: DSN_B, ...BASE });
    expect(Sdk.getClient()).toBe(second);
    expect(Sdk.getClient()).not.toBe(first);
  });
});

// ---------------------------------------------------------------------------
// Convenience fns — no-op silently when defaultClient is null
// ---------------------------------------------------------------------------

describe("Convenience fns — no-op when client is null (before init / after close)", () => {
  beforeEach(async () => {
    vi.useFakeTimers();
    await Sdk.close(); // ensure null
  });

  afterEach(async () => {
    await Sdk.close();
    vi.useRealTimers();
  });

  it("captureError() does not throw when no client", () => {
    expect(() => Sdk.captureError(new Error("test"))).not.toThrow();
  });

  it("log() does not throw when no client", () => {
    expect(() => Sdk.log("info", "test")).not.toThrow();
  });

  it("setUser() does not throw when no client", () => {
    expect(() => Sdk.setUser({ id: "u1" })).not.toThrow();
  });

  it("setTag() does not throw when no client", () => {
    expect(() => Sdk.setTag("key", "value")).not.toThrow();
  });

  it("flush() resolves without throwing when no client", async () => {
    await expect(Sdk.flush()).resolves.toBeUndefined();
  });

  it("close() resolves without throwing when already null", async () => {
    await expect(Sdk.close()).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Convenience fns — delegate to the active client
// ---------------------------------------------------------------------------

describe("Convenience fns — delegate to the active client", () => {
  let client: TelerithmClient;

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    await Sdk.close();
    client = Sdk.init({ dsn: DSN_A, ...BASE });
  });

  afterEach(async () => {
    await Sdk.close();
    vi.useRealTimers();
  });

  it("Sdk.log() forwards to client.log()", async () => {
    const spy = vi.spyOn(client, "log");
    Sdk.log("warn", "hello", { x: 1 });
    expect(spy).toHaveBeenCalledWith("warn", "hello", { x: 1 });
  });

  it("Sdk.captureError() forwards to client.captureError()", () => {
    const spy = vi.spyOn(client, "captureError");
    const err = new Error("oops");
    Sdk.captureError(err);
    expect(spy).toHaveBeenCalledWith(err, undefined);
  });

  it("Sdk.setUser() forwards to client.setUser()", () => {
    const spy = vi.spyOn(client, "setUser");
    Sdk.setUser({ id: "u1" });
    expect(spy).toHaveBeenCalledWith({ id: "u1" });
  });

  it("Sdk.setTag() forwards to client.setTag()", () => {
    const spy = vi.spyOn(client, "setTag");
    Sdk.setTag("region", "eu");
    expect(spy).toHaveBeenCalledWith("region", "eu");
  });

  it("Sdk.flush() forwards to client.flush()", async () => {
    const spy = vi.spyOn(client, "flush");
    await Sdk.flush();
    expect(spy).toHaveBeenCalledOnce();
  });
});
