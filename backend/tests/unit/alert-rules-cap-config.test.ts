import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ALERT_RULES_MAX_PER_TEAM caps the alert rules one team may own. Default
// 100; a value below 1 or a non-number fails startup.

const REQUIRED_ENV = {
  DATABASE_URL: "postgresql://test:test@localhost:5432/test",
  CLICKHOUSE_URL: "http://localhost:8123",
};

async function loadConfigWith(value: string | undefined) {
  vi.resetModules();
  if (value === undefined) delete process.env.ALERT_RULES_MAX_PER_TEAM;
  else process.env.ALERT_RULES_MAX_PER_TEAM = value;
  return import("../../src/config/index.js");
}

describe("ALERT_RULES_MAX_PER_TEAM config", () => {
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of ["DATABASE_URL", "CLICKHOUSE_URL", "ALERT_RULES_MAX_PER_TEAM"])
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

  it("defaults to 100 when unset", async () => {
    expect((await loadConfigWith(undefined)).config.alertRulesMaxPerTeam).toBe(100);
  });

  it("takes the env value when set", async () => {
    expect((await loadConfigWith("1")).config.alertRulesMaxPerTeam).toBe(1);
    expect((await loadConfigWith("500")).config.alertRulesMaxPerTeam).toBe(500);
  });

  it("rejects 0, a negative, an empty and a non-numeric value at startup (an empty value is not the same as unset)", async () => {
    await expect(loadConfigWith("")).rejects.toThrow(/alertRulesMaxPerTeam/);
    await expect(loadConfigWith("0")).rejects.toThrow(/alertRulesMaxPerTeam/);
    await expect(loadConfigWith("-1")).rejects.toThrow(/alertRulesMaxPerTeam/);
    await expect(loadConfigWith("abc")).rejects.toThrow(/alertRulesMaxPerTeam/);
  });
});
