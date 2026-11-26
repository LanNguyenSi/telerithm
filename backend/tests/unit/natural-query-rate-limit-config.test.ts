import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// NATURAL_QUERY_RATE_LIMIT_WINDOW_MS / NATURAL_QUERY_RATE_LIMIT_MAX configure
// the per-user limit of the natural-language query routes (naturalQueryLimiter
// in backend/src/api/rest/router.ts). Defaults: 60000 ms and 20 requests. The
// two variables are read and validated independently: each one falls back to
// its own default when unset, so setting one never changes the other.
// 0, a negative, an empty and a non-numeric value fail startup.

const REQUIRED_ENV = {
  DATABASE_URL: "postgresql://test:test@localhost:5432/test",
  CLICKHOUSE_URL: "http://localhost:8123",
};

async function loadConfigWith(windowMs: string | undefined, max: string | undefined) {
  vi.resetModules();
  if (windowMs === undefined) delete process.env.NATURAL_QUERY_RATE_LIMIT_WINDOW_MS;
  else process.env.NATURAL_QUERY_RATE_LIMIT_WINDOW_MS = windowMs;
  if (max === undefined) delete process.env.NATURAL_QUERY_RATE_LIMIT_MAX;
  else process.env.NATURAL_QUERY_RATE_LIMIT_MAX = max;
  return import("../../src/config/index.js");
}

describe("NATURAL_QUERY_RATE_LIMIT_* config", () => {
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of [
      "DATABASE_URL",
      "CLICKHOUSE_URL",
      "NATURAL_QUERY_RATE_LIMIT_WINDOW_MS",
      "NATURAL_QUERY_RATE_LIMIT_MAX",
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

  it("defaults to 60000 ms and 20 requests when both variables are unset", async () => {
    const { config } = await loadConfigWith(undefined, undefined);
    expect(config.naturalQueryRateLimitWindowMs).toBe(60_000);
    expect(config.naturalQueryRateLimitMax).toBe(20);
  });

  it("window alone: the env value wins over its 60000 default, the unset max keeps its own 20 default", async () => {
    const { config } = await loadConfigWith("2500", undefined);
    expect(config.naturalQueryRateLimitWindowMs).toBe(2500);
    expect(config.naturalQueryRateLimitMax).toBe(20);
  });

  it("max alone: the env value wins over its 20 default, the unset window keeps its own 60000 default", async () => {
    const { config } = await loadConfigWith(undefined, "3");
    expect(config.naturalQueryRateLimitWindowMs).toBe(60_000);
    expect(config.naturalQueryRateLimitMax).toBe(3);
  });

  it("both together: each env value wins over its own default", async () => {
    const { config } = await loadConfigWith("2500", "3");
    expect(config.naturalQueryRateLimitWindowMs).toBe(2500);
    expect(config.naturalQueryRateLimitMax).toBe(3);
  });

  it.each(["", "0", "-3", "many"])(
    "rejects the window value %j at startup (an empty value is not the same as unset)",
    async (value) => {
      await expect(loadConfigWith(value, undefined)).rejects.toThrow(/naturalQueryRateLimitWindowMs/);
    },
  );

  it.each(["", "0", "-3", "many"])(
    "rejects the max value %j at startup (an empty value is not the same as unset)",
    async (value) => {
      await expect(loadConfigWith(undefined, value)).rejects.toThrow(/naturalQueryRateLimitMax/);
    },
  );

  it("an invalid window is refused even when the max is set and valid", async () => {
    await expect(loadConfigWith("0", "5")).rejects.toThrow(/naturalQueryRateLimitWindowMs/);
  });

  it("an invalid max is refused even when the window is set and valid", async () => {
    await expect(loadConfigWith("5000", "0")).rejects.toThrow(/naturalQueryRateLimitMax/);
  });
});
