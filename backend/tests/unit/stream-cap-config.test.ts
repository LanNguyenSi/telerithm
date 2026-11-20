import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// MAX_STREAMS_PER_USER caps the open live tail streams of one user, per backend
// process. Default 5; a value below 1 or a non-number fails startup.

const REQUIRED_ENV = {
  DATABASE_URL: "postgresql://test:test@localhost:5432/test",
  CLICKHOUSE_URL: "http://localhost:8123",
};

async function loadConfigWith(value: string | undefined) {
  vi.resetModules();
  if (value === undefined) delete process.env.MAX_STREAMS_PER_USER;
  else process.env.MAX_STREAMS_PER_USER = value;
  return import("../../src/config/index.js");
}

describe("MAX_STREAMS_PER_USER config", () => {
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of ["DATABASE_URL", "CLICKHOUSE_URL", "MAX_STREAMS_PER_USER"])
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

  it("defaults to 5 when unset", async () => {
    expect((await loadConfigWith(undefined)).config.maxStreamsPerUser).toBe(5);
  });

  it("takes the env value when set", async () => {
    expect((await loadConfigWith("1")).config.maxStreamsPerUser).toBe(1);
    expect((await loadConfigWith("20")).config.maxStreamsPerUser).toBe(20);
  });

  it("rejects 0, a negative, an empty and a non-numeric value at startup (an empty value is not the same as unset)", async () => {
    await expect(loadConfigWith("")).rejects.toThrow(/maxStreamsPerUser/);
    await expect(loadConfigWith("0")).rejects.toThrow(/maxStreamsPerUser/);
    await expect(loadConfigWith("-3")).rejects.toThrow(/maxStreamsPerUser/);
    await expect(loadConfigWith("many")).rejects.toThrow(/maxStreamsPerUser/);
  });
});
