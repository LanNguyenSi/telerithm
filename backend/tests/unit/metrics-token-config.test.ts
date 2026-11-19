// Unit tests for the METRICS_TOKEN entry of the real config module
// (backend/src/config/index.ts). The bearer check and the endpoint answers
// are pinned in metrics-auth.test.ts and tests/integration/api.test.ts; this
// file pins loading the value from process.env: unset, empty, white space and
// short values must never produce a token that /metrics or the health detail
// would accept, and must never break startup for the values the prod
// composes pass (${METRICS_TOKEN:-}).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Required env for loading the real config module; set before any import of it.
const REQUIRED_ENV = {
  DATABASE_URL: "postgresql://test:test@localhost:5432/test",
  CLICKHOUSE_URL: "http://localhost:8123",
};

async function loadConfigWith(metricsToken: string | undefined) {
  vi.resetModules();
  if (metricsToken === undefined) delete process.env.METRICS_TOKEN;
  else process.env.METRICS_TOKEN = metricsToken;
  return import("../../src/config/index.js");
}

// A 32-character token, and one character short of the minimum.
const TOKEN_32 = `cfg-metrics-${"z".repeat(20)}`;
const TOKEN_31 = "x".repeat(31);

describe("METRICS_TOKEN config", () => {
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of ["DATABASE_URL", "CLICKHOUSE_URL", "METRICS_TOKEN"]) saved[key] = process.env[key];
    Object.assign(process.env, REQUIRED_ENV);
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    vi.resetModules();
  });

  it("is undefined when METRICS_TOKEN is unset", async () => {
    expect((await loadConfigWith(undefined)).config.metricsToken).toBeUndefined();
  });

  // Both prod composes pass the variable as ${METRICS_TOKEN:-}, so an empty
  // string (the unset rendering) must load cleanly, endpoint disabled, and
  // must never fail startup.
  it("is undefined for an empty string, without failing startup", async () => {
    expect((await loadConfigWith("")).config.metricsToken).toBeUndefined();
  });

  // Node trims header values, so a token that is only white space could never
  // match a presented bearer value, however long it is: it counts as unset.
  it.each([" ", "   ", " ".repeat(32), "\t\n "])(
    "is undefined for the white-space-only value %j",
    async (value) => {
      expect((await loadConfigWith(value)).config.metricsToken).toBeUndefined();
    },
  );

  it("reads the token from process.env.METRICS_TOKEN", async () => {
    // Distinct value: proves loadConfig reads this exact env var.
    expect((await loadConfigWith("env-metrics-token-0123456789abcd")).config.metricsToken).toBe(
      "env-metrics-token-0123456789abcd",
    );
  });

  it("accepts a token of exactly 32 characters, kept verbatim", async () => {
    expect(TOKEN_32).toHaveLength(32);
    expect((await loadConfigWith(TOKEN_32)).config.metricsToken).toBe(TOKEN_32);
  });

  it("rejects 31 characters at startup, naming the setting without echoing the value", async () => {
    await expect(loadConfigWith(TOKEN_31)).rejects.toThrow(/Invalid configuration:[\s\S]*metricsToken/);
    await expect(loadConfigWith(TOKEN_31)).rejects.toThrow(
      /METRICS_TOKEN must be at least 32 characters/,
    );
    // The invalid value must not be echoed back in the error.
    await expect(loadConfigWith(TOKEN_31)).rejects.not.toThrow(TOKEN_31);
  });

  // The length check runs on the trimmed value: 31 characters padded to 32
  // are refused (with the padding, not the length, ruled out as the reason),
  // and a valid token that arrives padded stores the trimmed token, which is
  // what the bearer comparison would need to match anyway.
  it("trims before the length check: padded 31 is refused, padded 32 keeps the trimmed value", async () => {
    await expect(loadConfigWith(`  ${TOKEN_31}  `)).rejects.toThrow(
      /METRICS_TOKEN must be at least 32 characters/,
    );
    expect((await loadConfigWith(` ${TOKEN_32} `)).config.metricsToken).toBe(TOKEN_32);
  });
});
