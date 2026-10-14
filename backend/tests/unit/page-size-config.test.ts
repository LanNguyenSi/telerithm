import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SEARCH_LIMIT_CEILING } from "../../src/constants/search.js";
import { searchSchema } from "../../src/validation/schemas.js";

// MAX_PAGE_SIZE and the search request schema's `limit` cap must agree: a
// configured maximum above the schema cap could never take effect, so the config
// clamps it to the cap and records a warning.

const REQUIRED_ENV = {
  DATABASE_URL: "postgresql://test:test@localhost:5432/test",
  CLICKHOUSE_URL: "http://localhost:8123",
};

async function loadConfigWith(maxPageSize: string | undefined) {
  vi.resetModules();
  if (maxPageSize === undefined) delete process.env.MAX_PAGE_SIZE;
  else process.env.MAX_PAGE_SIZE = maxPageSize;
  return import("../../src/config/index.js");
}

describe("MAX_PAGE_SIZE config", () => {
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of ["DATABASE_URL", "CLICKHOUSE_URL", "MAX_PAGE_SIZE"]) saved[key] = process.env[key];
    Object.assign(process.env, REQUIRED_ENV);
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    vi.resetModules();
  });

  it("defaults to the search schema's limit ceiling", async () => {
    expect((await loadConfigWith(undefined)).config.maxPageSize).toBe(SEARCH_LIMIT_CEILING);
  });

  it("accepts values from 50 up to the ceiling", async () => {
    expect((await loadConfigWith("50")).config.maxPageSize).toBe(50);
    expect((await loadConfigWith(String(SEARCH_LIMIT_CEILING))).config.maxPageSize).toBe(SEARCH_LIMIT_CEILING);
  });

  it("clamps a value above the ceiling to the ceiling and records one warning naming both numbers", async () => {
    const { config, configWarnings } = await loadConfigWith(String(SEARCH_LIMIT_CEILING + 1));

    expect(config.maxPageSize).toBe(SEARCH_LIMIT_CEILING);
    expect(configWarnings).toHaveLength(1);
    expect(configWarnings[0]).toContain(`MAX_PAGE_SIZE=${SEARCH_LIMIT_CEILING + 1}`);
    expect(configWarnings[0]).toContain(`cap of ${SEARCH_LIMIT_CEILING}`);
  });

  it("clamps a very large value too (the old 2000 maximum no longer fails startup)", async () => {
    const { config, configWarnings } = await loadConfigWith("5000");

    expect(config.maxPageSize).toBe(SEARCH_LIMIT_CEILING);
    expect(configWarnings).toHaveLength(1);
  });

  it("records no warning at or below the ceiling", async () => {
    expect((await loadConfigWith(String(SEARCH_LIMIT_CEILING))).configWarnings).toEqual([]);
    expect((await loadConfigWith("50")).configWarnings).toEqual([]);
    expect((await loadConfigWith(undefined)).configWarnings).toEqual([]);
  });

  it("still rejects a non-numeric value", async () => {
    await expect(loadConfigWith("lots")).rejects.toThrow(/maxPageSize/);
  });

  it("rejects a value below 50", async () => {
    await expect(loadConfigWith("49")).rejects.toThrow(/maxPageSize/);
  });
});

describe("search request limit", () => {
  it("uses the same ceiling as the configuration", () => {
    expect(searchSchema.safeParse({ teamId: "t1", limit: SEARCH_LIMIT_CEILING }).success).toBe(true);
    expect(searchSchema.safeParse({ teamId: "t1", limit: SEARCH_LIMIT_CEILING + 1 }).success).toBe(false);
  });
});
