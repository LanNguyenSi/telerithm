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

  it("accepts the largest allowed hop count and rejects one above it", async () => {
    expect((await loadConfigWith("10")).config.trustProxy).toBe(10);
    await expect(loadConfigWith("11")).rejects.toThrow(
      /Invalid configuration:[\s\S]*trustProxy[\s\S]*TRUST_PROXY="11" is not allowed: a hop count above 10/,
    );
  });

  // Each of these makes Express trust every hop (or every IPv4 peer), which is
  // the same spoofable setup as `true`: a hop count above any real chain
  // (including values that are not safe integers), and ranges that cover all
  // of IPv4 or IPv6, directly, as IPv4-mapped IPv6, or as a split pair.
  it.each([
    ["99999999", /hop count above 10/],
    ["9007199254740993", /hop count above 10/],
    ["1".repeat(400), /hop count above 10/],
    ["0.0.0.0/0", /"0\.0\.0\.0\/0" is not allowed: IPv4 prefix \/0 is shorter than \/8/],
    ["::/0", /"::\/0" is not allowed: IPv6 prefix \/0 is shorter than \/32/],
    ["10.0.0.1, 0.0.0.0/0", /"0\.0\.0\.0\/0" is not allowed/],
    ["0.0.0.0/1,128.0.0.0/1", /"0\.0\.0\.0\/1" is not allowed: IPv4 prefix \/1/],
    ["0.0.0.0/7", /IPv4 prefix \/7 is shorter than \/8/],
    ["2001:db8::/31", /IPv6 prefix \/31 is shorter than \/32/],
    ["::ffff:0:0/96", /"::ffff:0:0\/96" is not allowed: the IPv6 range \/96 contains the IPv4-mapped block/],
    ["::ffff:0.0.0.0/96", /contains the IPv4-mapped block/],
    ["::ffff:0:0/80", /contains the IPv4-mapped block/],
    ["::/32", /contains the IPv4-mapped block/],
    ["::/64", /contains the IPv4-mapped block/],
    ["::ffff:0:0/103", /IPv4-mapped prefix \/103 is the IPv4 prefix \/7/],
    ["::ffff:0:0/100", /IPv4-mapped prefix \/100 is the IPv4 prefix \/4/],
    // Network bits differ from ::ffff:0:0 only below the prefix length, so the
    // range still contains the whole IPv4-mapped block.
    ["::fffe:0:0/95", /"::fffe:0:0\/95" is not allowed: the IPv6 range \/95 contains the IPv4-mapped block/],
  ])("rejects the trust-everything value %j and names the rule", async (value, rule) => {
    await expect(loadConfigWith(value)).rejects.toThrow(/Invalid configuration:[\s\S]*trustProxy/);
    await expect(loadConfigWith(value)).rejects.toThrow(rule);
  });

  it("accepts ranges right at the length bounds", async () => {
    expect((await loadConfigWith("10.0.0.0/8")).config.trustProxy).toEqual(["10.0.0.0/8"]);
    expect((await loadConfigWith("2001:db8::/32")).config.trustProxy).toEqual(["2001:db8::/32"]);
    expect((await loadConfigWith("::ffff:10.0.0.0/104")).config.trustProxy).toEqual(["::ffff:10.0.0.0/104"]);
    expect((await loadConfigWith("::/96")).config.trustProxy).toEqual(["::/96"]);
    expect((await loadConfigWith("::ffff:1.2.3.4")).config.trustProxy).toEqual(["::ffff:1.2.3.4"]);
    expect((await loadConfigWith("0.0.0.0/32")).config.trustProxy).toEqual(["0.0.0.0/32"]);
    // Right next to the mapped block but not containing it.
    expect((await loadConfigWith("::fffe:0:0/96")).config.trustProxy).toEqual(["::fffe:0:0/96"]);
  });

  // node:net accepts these IPv6 spellings, Express's proxy-addr does not; they
  // must fail as a configuration error, not later inside app.set.
  it.each(["::1.2.3.4", "1::1.2.3.4", "::0.0.0.0/96", "fe80::1%eth0.5/64"])(
    "rejects %j, which Express cannot parse, at config time",
    async (value) => {
      await expect(loadConfigWith(value)).rejects.toThrow(/Invalid configuration:[\s\S]*trustProxy/);
      await expect(loadConfigWith(value)).rejects.toThrow(/Express cannot use it/);
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
