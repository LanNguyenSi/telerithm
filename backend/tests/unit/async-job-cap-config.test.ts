import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ASYNC_JOBS_MAX_INFLIGHT_PER_TEAM and ASYNC_JOBS_MAX_INFLIGHT cap the pending
// async query jobs of one team and of the whole backend process. Defaults 10 and
// 100; a value below 1 or a non-number fails startup. The two variables are
// independent of each other.

const REQUIRED_ENV = {
  DATABASE_URL: "postgresql://test:test@localhost:5432/test",
  CLICKHOUSE_URL: "http://localhost:8123",
};
const KEYS = ["ASYNC_JOBS_MAX_INFLIGHT_PER_TEAM", "ASYNC_JOBS_MAX_INFLIGHT"] as const;

async function loadConfigWith(values: Partial<Record<(typeof KEYS)[number], string>>) {
  vi.resetModules();
  for (const key of KEYS) {
    const value = values[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  return import("../../src/config/index.js");
}

describe("async query job cap config", () => {
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of ["DATABASE_URL", "CLICKHOUSE_URL", ...KEYS]) saved[key] = process.env[key];
    Object.assign(process.env, REQUIRED_ENV);
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    vi.resetModules();
  });

  it("defaults to 10 per team and 100 per process when both are unset", async () => {
    const { config } = await loadConfigWith({});
    expect(config.asyncJobsMaxInflightPerTeam).toBe(10);
    expect(config.asyncJobsMaxInflight).toBe(100);
  });

  it("takes the per-team value alone and leaves the process default", async () => {
    const { config } = await loadConfigWith({ ASYNC_JOBS_MAX_INFLIGHT_PER_TEAM: "4" });
    expect(config.asyncJobsMaxInflightPerTeam).toBe(4);
    expect(config.asyncJobsMaxInflight).toBe(100);
  });

  it("takes the process value alone and leaves the per-team default", async () => {
    const { config } = await loadConfigWith({ ASYNC_JOBS_MAX_INFLIGHT: "7" });
    expect(config.asyncJobsMaxInflightPerTeam).toBe(10);
    expect(config.asyncJobsMaxInflight).toBe(7);
  });

  it("takes both values when both are set", async () => {
    const { config } = await loadConfigWith({
      ASYNC_JOBS_MAX_INFLIGHT_PER_TEAM: "2",
      ASYNC_JOBS_MAX_INFLIGHT: "3",
    });
    expect(config.asyncJobsMaxInflightPerTeam).toBe(2);
    expect(config.asyncJobsMaxInflight).toBe(3);
  });

  it.each([
    ["ASYNC_JOBS_MAX_INFLIGHT_PER_TEAM", "asyncJobsMaxInflightPerTeam"],
    ["ASYNC_JOBS_MAX_INFLIGHT", "asyncJobsMaxInflight"],
  ] as const)(
    "rejects 0, a negative, an empty and a non-numeric %s at startup (an empty value is not the same as unset)",
    async (envKey, configKey) => {
      for (const value of ["", "0", "-3", "many"]) {
        await expect(loadConfigWith({ [envKey]: value })).rejects.toThrow(new RegExp(`${configKey}:`));
      }
    },
  );
});
