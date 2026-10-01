import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Required env for loading the real config module; set before any import of it.
const REQUIRED_ENV = {
  DATABASE_URL: "postgresql://test:test@localhost:5432/test",
  CLICKHOUSE_URL: "http://localhost:8123",
};

async function loadConfigWith(trustProxy: string | undefined) {
  vi.resetModules();
  if (trustProxy === undefined) delete process.env.TRUST_PROXY;
  else process.env.TRUST_PROXY = trustProxy;
  return import("../../src/config/index.js");
}

describe("TRUST_PROXY config", () => {
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of ["DATABASE_URL", "CLICKHOUSE_URL", "TRUST_PROXY"]) saved[key] = process.env[key];
    Object.assign(process.env, REQUIRED_ENV);
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    vi.resetModules();
  });

  it("is off (undefined) when TRUST_PROXY is unset or blank", async () => {
    expect((await loadConfigWith(undefined)).config.trustProxy).toBeUndefined();
    expect((await loadConfigWith("")).config.trustProxy).toBeUndefined();
    expect((await loadConfigWith("   ")).config.trustProxy).toBeUndefined();
  });

  it("accepts a non-negative integer hop count as a number", async () => {
    expect((await loadConfigWith("1")).config.trustProxy).toBe(1);
    expect((await loadConfigWith("2")).config.trustProxy).toBe(2);
    expect((await loadConfigWith("0")).config.trustProxy).toBe(0);
  });

  it("accepts the loopback keyword", async () => {
    expect((await loadConfigWith("loopback")).config.trustProxy).toBe("loopback");
  });

  it("accepts a comma-separated list of IPs and CIDRs", async () => {
    expect((await loadConfigWith("10.0.0.1")).config.trustProxy).toEqual(["10.0.0.1"]);
    expect((await loadConfigWith("172.18.0.0/16, 10.0.0.0/8 ,::1,2001:db8::/32")).config.trustProxy).toEqual([
      "172.18.0.0/16",
      "10.0.0.0/8",
      "::1",
      "2001:db8::/32",
    ]);
  });

  it.each(["true", "TRUE", " true "])(
    "rejects the boolean %j at startup with a clear error",
    async (value) => {
      await expect(loadConfigWith(value)).rejects.toThrow(/TRUST_PROXY=true is not allowed.*spoof/s);
    },
  );

  it.each([
    "false",
    "-1",
    "1.5",
    "yes",
    "linklocal",
    "10.0.0.1,",
    ",10.0.0.1",
    "10.0.0.1,2",
    "10.0.0.0/33",
    "::1/129",
    "10.0.0.0/",
    "10.0.0.0/abc",
    "999.1.1.1",
    "not-an-ip",
  ])("rejects the invalid value %j", async (value) => {
    await expect(loadConfigWith(value)).rejects.toThrow(/Invalid configuration:[\s\S]*trustProxy/);
  });
});

describe("docker-compose.traefik.yml", () => {
  it("sets TRUST_PROXY for the backend to the single Traefik hop by default", () => {
    const composePath = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "../../../docker-compose.traefik.yml",
    );
    const compose = readFileSync(composePath, "utf8");
    expect(compose).toMatch(/^\s+TRUST_PROXY: \$\{TRUST_PROXY:-1\}\s*$/m);
  });
});
