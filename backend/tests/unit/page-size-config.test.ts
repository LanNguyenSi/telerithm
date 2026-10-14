import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SEARCH_LIMIT_CEILING } from "../../src/constants/search.js";
import { searchSchema } from "../../src/validation/schemas.js";

// MAX_PAGE_SIZE and the search request schema's `limit` cap must agree: a
// configured maximum above the schema cap would be accepted at startup but could
// never take effect.

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

  it("rejects a value above the ceiling at startup, naming the setting", async () => {
    await expect(loadConfigWith(String(SEARCH_LIMIT_CEILING + 1))).rejects.toThrow(/maxPageSize/);
    await expect(loadConfigWith("2000")).rejects.toThrow(/Invalid configuration/);
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
