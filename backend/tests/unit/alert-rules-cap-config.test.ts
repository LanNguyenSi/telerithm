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

// ALERT_EVAL_MAX_RULES_PER_TICK bounds how many alert rules the evaluation
// worker evaluates in one tick. Default 1000; a value below 1 or a non-number
// fails startup. Each input is tested alone.

async function loadConfigWithBudget(value: string | undefined) {
  vi.resetModules();
  if (value === undefined) delete process.env.ALERT_EVAL_MAX_RULES_PER_TICK;
  else process.env.ALERT_EVAL_MAX_RULES_PER_TICK = value;
  return import("../../src/config/index.js");
}

describe("ALERT_EVAL_MAX_RULES_PER_TICK config", () => {
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of [
      "DATABASE_URL",
      "CLICKHOUSE_URL",
      "ALERT_RULES_MAX_PER_TEAM",
      "ALERT_EVAL_MAX_RULES_PER_TICK",
    ]) {
      saved[key] = process.env[key];
    }
    Object.assign(process.env, REQUIRED_ENV);
    delete process.env.ALERT_RULES_MAX_PER_TEAM;
    delete process.env.ALERT_EVAL_MAX_RULES_PER_TICK;
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    vi.resetModules();
  });

  it("defaults to 1000 when unset", async () => {
    expect((await loadConfigWithBudget(undefined)).config.alertEvalMaxRulesPerTick).toBe(1000);
  });

  it("takes the env value when set", async () => {
    expect((await loadConfigWithBudget("1")).config.alertEvalMaxRulesPerTick).toBe(1);
  });

  it("takes a large env value when set", async () => {
    expect((await loadConfigWithBudget("5000")).config.alertEvalMaxRulesPerTick).toBe(5000);
  });

  it("rejects an empty value at startup (an empty value is not the same as unset)", async () => {
    await expect(loadConfigWithBudget("")).rejects.toThrow(/alertEvalMaxRulesPerTick/);
  });

  it("rejects 0 at startup", async () => {
    await expect(loadConfigWithBudget("0")).rejects.toThrow(/alertEvalMaxRulesPerTick/);
  });

  it("rejects a negative value at startup", async () => {
    await expect(loadConfigWithBudget("-1")).rejects.toThrow(/alertEvalMaxRulesPerTick/);
  });

  it("rejects a non-numeric value at startup", async () => {
    await expect(loadConfigWithBudget("abc")).rejects.toThrow(/alertEvalMaxRulesPerTick/);
  });

  it("drives its own key alone: the per-team cap value does not change it, and vice versa", async () => {
    vi.resetModules();
    delete process.env.ALERT_EVAL_MAX_RULES_PER_TICK;
    process.env.ALERT_RULES_MAX_PER_TEAM = "5";
    let mod = await import("../../src/config/index.js");
    expect(mod.config.alertEvalMaxRulesPerTick).toBe(1000);
    expect(mod.config.alertRulesMaxPerTeam).toBe(5);

    vi.resetModules();
    delete process.env.ALERT_RULES_MAX_PER_TEAM;
    process.env.ALERT_EVAL_MAX_RULES_PER_TICK = "7";
    mod = await import("../../src/config/index.js");
    expect(mod.config.alertEvalMaxRulesPerTick).toBe(7);
    expect(mod.config.alertRulesMaxPerTeam).toBe(100);
    delete process.env.ALERT_EVAL_MAX_RULES_PER_TICK;
  });
});
