import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// STREAM_TICKET_RATE_LIMIT_WINDOW_MS / STREAM_TICKET_RATE_LIMIT_MAX configure
// the per-user limit of the stream ticket route, POST /stream/ticket (streamTicketLimiter
// in backend/src/api/rest/router.ts). Defaults: 60000 ms and 30 requests. The
// two variables are read and validated independently: each one falls back to
// its own default when unset, so setting one never changes the other.
// 0, a negative, an empty and a non-numeric value fail startup.

const REQUIRED_ENV = {
  DATABASE_URL: "postgresql://test:test@localhost:5432/test",
  CLICKHOUSE_URL: "http://localhost:8123",
};

async function loadConfigWith(windowMs: string | undefined, max: string | undefined) {
  vi.resetModules();
  if (windowMs === undefined) delete process.env.STREAM_TICKET_RATE_LIMIT_WINDOW_MS;
  else process.env.STREAM_TICKET_RATE_LIMIT_WINDOW_MS = windowMs;
  if (max === undefined) delete process.env.STREAM_TICKET_RATE_LIMIT_MAX;
  else process.env.STREAM_TICKET_RATE_LIMIT_MAX = max;
  return import("../../src/config/index.js");
}

describe("STREAM_TICKET_RATE_LIMIT_* config", () => {
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of [
      "DATABASE_URL",
      "CLICKHOUSE_URL",
      "STREAM_TICKET_RATE_LIMIT_WINDOW_MS",
      "STREAM_TICKET_RATE_LIMIT_MAX",
    ])
      saved[key] = process.env[key];
    Object.assign(process.env, REQUIRED_ENV);
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    vi.resetModules();
  });

  it("defaults to 60000 ms and 30 requests when both variables are unset", async () => {
    const { config } = await loadConfigWith(undefined, undefined);
    expect(config.streamTicketRateLimitWindowMs).toBe(60_000);
    expect(config.streamTicketRateLimitMax).toBe(30);
  });

  it("window alone: the env value wins over its 60000 default, the unset max keeps its own 30 default", async () => {
    const { config } = await loadConfigWith("2500", undefined);
    expect(config.streamTicketRateLimitWindowMs).toBe(2500);
    expect(config.streamTicketRateLimitMax).toBe(30);
  });

  it("max alone: the env value wins over its 30 default, the unset window keeps its own 60000 default", async () => {
    const { config } = await loadConfigWith(undefined, "3");
    expect(config.streamTicketRateLimitWindowMs).toBe(60_000);
    expect(config.streamTicketRateLimitMax).toBe(3);
  });

  it("both together: each env value wins over its own default", async () => {
    const { config } = await loadConfigWith("2500", "3");
    expect(config.streamTicketRateLimitWindowMs).toBe(2500);
    expect(config.streamTicketRateLimitMax).toBe(3);
  });

  it.each(["", "0", "-3", "many"])(
    "rejects the window value %j at startup (an empty value is not the same as unset)",
    async (value) => {
      await expect(loadConfigWith(value, undefined)).rejects.toThrow(/streamTicketRateLimitWindowMs/);
    },
  );

  it.each(["", "0", "-3", "many"])(
    "rejects the max value %j at startup (an empty value is not the same as unset)",
    async (value) => {
      await expect(loadConfigWith(undefined, value)).rejects.toThrow(/streamTicketRateLimitMax/);
    },
  );

  it("an invalid window is refused even when the max is set and valid", async () => {
    await expect(loadConfigWith("0", "5")).rejects.toThrow(/streamTicketRateLimitWindowMs/);
  });

  it("an invalid max is refused even when the window is set and valid", async () => {
    await expect(loadConfigWith("5000", "0")).rejects.toThrow(/streamTicketRateLimitMax/);
  });
});
