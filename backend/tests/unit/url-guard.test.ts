/**
 * Unit tests for the SSRF guard: assertSafeUrl.
 *
 * Implementation note — Node.js URL.hostname and IPv6 brackets:
 *   Node.js's WHATWG URL implementation preserves brackets when serialising
 *   IPv6 hostnames, so `new URL("https://[::1]/hook").hostname` returns
 *   "[::1]", not "::1".  As a consequence, isIP("[::1]") returns 0 (not 6),
 *   and the literal-IP branch is never taken for IPv6 literal addresses;
 *   instead they fall through to the DNS resolution path.
 *
 *   In real usage this still blocks the request — DNS fails to resolve
 *   "[::1]" → the guard throws "could not be resolved". In tests we simulate
 *   that DNS failure by having mockLookup reject.
 *
 *   IPv6 addresses returned BY DNS (without brackets, e.g. from AAAA records)
 *   ARE correctly checked by isBlockedAddress; those cases are covered in the
 *   "DNS resolution" describe block.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// vi.mock calls are hoisted to the top of the file by vitest
vi.mock("node:dns/promises", () => ({
  lookup: vi.fn(),
}));

vi.mock("../../src/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), fatal: vi.fn() },
  createChildLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

import { lookup } from "node:dns/promises";
import { assertSafeUrl } from "../../src/services/notification/url-guard.js";

const mockLookup = vi.mocked(lookup);

// Helper: configure lookup to return a single public A-record
function mockPublicAddress() {
  mockLookup.mockResolvedValueOnce([{ address: "93.184.216.34", family: 4 }] as never);
}

// Helper: configure lookup to reject (ENOTFOUND) — used for DNS-path IPv6 literal tests
function mockDnsFail() {
  mockLookup.mockRejectedValueOnce(new Error("ENOTFOUND"));
}

describe("assertSafeUrl — scheme validation", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    delete process.env.WEBHOOK_HOST_ALLOWLIST;
  });

  afterEach(() => {
    delete process.env.WEBHOOK_HOST_ALLOWLIST;
  });

  it("accepts an https URL that resolves to a public IP", async () => {
    mockPublicAddress();
    await expect(assertSafeUrl("https://example.com/hook")).resolves.toBeUndefined();
  });

  it("accepts an http URL that resolves to a public IP", async () => {
    mockPublicAddress();
    await expect(assertSafeUrl("http://example.com/hook")).resolves.toBeUndefined();
  });

  it("rejects ftp:// scheme", async () => {
    await expect(assertSafeUrl("ftp://example.com/file")).rejects.toThrow("Unsupported webhook scheme");
  });

  it("rejects file:// scheme", async () => {
    await expect(assertSafeUrl("file:///etc/passwd")).rejects.toThrow("Unsupported webhook scheme");
  });

  it("rejects a completely unparseable string", async () => {
    await expect(assertSafeUrl("not a url")).rejects.toThrow("Invalid webhook URL");
  });

  it("rejects an empty string", async () => {
    await expect(assertSafeUrl("")).rejects.toThrow("Invalid webhook URL");
  });
});

describe("assertSafeUrl — IPv4 blocked ranges (literal IP, no DNS)", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    delete process.env.WEBHOOK_HOST_ALLOWLIST;
  });

  afterEach(() => {
    delete process.env.WEBHOOK_HOST_ALLOWLIST;
  });

  it("blocks loopback 127.0.0.1", async () => {
    await expect(assertSafeUrl("https://127.0.0.1/hook")).rejects.toThrow("blocked address range");
    expect(mockLookup).not.toHaveBeenCalled();
  });

  it("blocks loopback 127.1.2.3 (entire 127.0.0.0/8 range)", async () => {
    await expect(assertSafeUrl("https://127.1.2.3/hook")).rejects.toThrow("blocked address range");
    expect(mockLookup).not.toHaveBeenCalled();
  });

  it("blocks private 10.0.0.1 (10.0.0.0/8)", async () => {
    await expect(assertSafeUrl("https://10.0.0.1/hook")).rejects.toThrow("blocked address range");
    expect(mockLookup).not.toHaveBeenCalled();
  });

  it("blocks private 10.255.255.255", async () => {
    await expect(assertSafeUrl("https://10.255.255.255/hook")).rejects.toThrow("blocked address range");
  });

  it("blocks private 192.168.1.100 (192.168.0.0/16)", async () => {
    await expect(assertSafeUrl("https://192.168.1.100/hook")).rejects.toThrow("blocked address range");
    expect(mockLookup).not.toHaveBeenCalled();
  });

  it("blocks private 172.16.0.1 (172.16.0.0/12)", async () => {
    await expect(assertSafeUrl("https://172.16.0.1/hook")).rejects.toThrow("blocked address range");
    expect(mockLookup).not.toHaveBeenCalled();
  });

  it("blocks private 172.31.255.255 (upper bound of 172.16.0.0/12)", async () => {
    await expect(assertSafeUrl("https://172.31.255.255/hook")).rejects.toThrow("blocked address range");
  });

  it("does NOT block 172.32.0.1 (just outside RFC1918 range)", async () => {
    // Literal public IP — no DNS lookup, resolves immediately
    await expect(assertSafeUrl("https://172.32.0.1/hook")).resolves.toBeUndefined();
    expect(mockLookup).not.toHaveBeenCalled();
  });

  it("blocks cloud metadata endpoint 169.254.169.254", async () => {
    await expect(assertSafeUrl("https://169.254.169.254/latest/meta-data/")).rejects.toThrow(
      "blocked address range",
    );
    expect(mockLookup).not.toHaveBeenCalled();
  });

  it("blocks link-local 169.254.1.1 (169.254.0.0/16)", async () => {
    await expect(assertSafeUrl("https://169.254.1.1/hook")).rejects.toThrow("blocked address range");
  });

  it("blocks unspecified 0.0.0.0", async () => {
    await expect(assertSafeUrl("https://0.0.0.0/hook")).rejects.toThrow("blocked address range");
  });

  it("blocks 0.x.x.x range (unspecified)", async () => {
    await expect(assertSafeUrl("https://0.1.2.3/hook")).rejects.toThrow("blocked address range");
  });

  it("blocks CGNAT 100.64.0.1 (100.64.0.0/10)", async () => {
    await expect(assertSafeUrl("https://100.64.0.1/hook")).rejects.toThrow("blocked address range");
  });

  it("blocks CGNAT 100.127.255.255 (upper bound of 100.64.0.0/10)", async () => {
    await expect(assertSafeUrl("https://100.127.255.255/hook")).rejects.toThrow("blocked address range");
  });

  it("does NOT block 100.63.0.1 (below CGNAT range)", async () => {
    await expect(assertSafeUrl("https://100.63.0.1/hook")).resolves.toBeUndefined();
    expect(mockLookup).not.toHaveBeenCalled();
  });

  it("blocks multicast 224.0.0.1 (224.0.0.0/4)", async () => {
    await expect(assertSafeUrl("https://224.0.0.1/hook")).rejects.toThrow("blocked address range");
  });

  it("blocks reserved 255.255.255.255", async () => {
    await expect(assertSafeUrl("https://255.255.255.255/hook")).rejects.toThrow("blocked address range");
  });
});

/**
 * IPv6 literal URL behaviour:
 *   Node.js preserves brackets in URL.hostname for IPv6, so isIP("[::1]") = 0.
 *   The code falls through to DNS lookup, which rejects (ENOTFOUND) for these
 *   bracket-wrapped addresses, and the guard throws "could not be resolved".
 *   The requests are correctly blocked — just via the DNS path, not the IP-range
 *   check.  We simulate the DNS failure with mockDnsFail().
 */
describe("assertSafeUrl — IPv6 literal URLs (blocked via DNS-failure path)", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    delete process.env.WEBHOOK_HOST_ALLOWLIST;
  });

  afterEach(() => {
    delete process.env.WEBHOOK_HOST_ALLOWLIST;
  });

  it("blocks https://[::1] (IPv6 loopback — DNS failure)", async () => {
    mockDnsFail();
    await expect(assertSafeUrl("https://[::1]/hook")).rejects.toThrow("could not be resolved");
  });

  it("blocks https://[::] (IPv6 unspecified — DNS failure)", async () => {
    mockDnsFail();
    await expect(assertSafeUrl("https://[::]/hook")).rejects.toThrow("could not be resolved");
  });

  it("blocks https://[fe80::1] (IPv6 link-local — DNS failure)", async () => {
    mockDnsFail();
    await expect(assertSafeUrl("https://[fe80::1]/hook")).rejects.toThrow("could not be resolved");
  });

  it("blocks https://[fc00::1] (IPv6 ULA — DNS failure)", async () => {
    mockDnsFail();
    await expect(assertSafeUrl("https://[fc00::1]/hook")).rejects.toThrow("could not be resolved");
  });

  it("blocks https://[fd00::1] (IPv6 ULA — DNS failure)", async () => {
    mockDnsFail();
    await expect(assertSafeUrl("https://[fd00::1]/hook")).rejects.toThrow("could not be resolved");
  });

  it("blocks https://[ff02::1] (IPv6 multicast — DNS failure)", async () => {
    mockDnsFail();
    await expect(assertSafeUrl("https://[ff02::1]/hook")).rejects.toThrow("could not be resolved");
  });

  it("blocks https://[::ffff:192.168.1.1] (IPv4-mapped — DNS failure)", async () => {
    mockDnsFail();
    await expect(assertSafeUrl("https://[::ffff:192.168.1.1]/hook")).rejects.toThrow("could not be resolved");
  });
});

/**
 * IPv6 addresses returned FROM DNS (AAAA records, no brackets).
 * These ARE correctly handled by isBlockedAddress's IPv6 checks.
 */
describe("assertSafeUrl — IPv6 DNS-resolved addresses (blocked via IP-range check)", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    delete process.env.WEBHOOK_HOST_ALLOWLIST;
  });

  afterEach(() => {
    delete process.env.WEBHOOK_HOST_ALLOWLIST;
  });

  it("blocks AAAA record ::1 (loopback)", async () => {
    mockLookup.mockResolvedValueOnce([{ address: "::1", family: 6 }] as never);
    await expect(assertSafeUrl("https://ipv6-loopback.example.com/hook")).rejects.toThrow("blocked address range");
  });

  it("blocks AAAA record :: (unspecified)", async () => {
    mockLookup.mockResolvedValueOnce([{ address: "::", family: 6 }] as never);
    await expect(assertSafeUrl("https://ipv6-unspecified.example.com/hook")).rejects.toThrow("blocked address range");
  });

  it("blocks AAAA record fe80::1 (link-local)", async () => {
    mockLookup.mockResolvedValueOnce([{ address: "fe80::1", family: 6 }] as never);
    await expect(assertSafeUrl("https://ipv6-link-local.example.com/hook")).rejects.toThrow("blocked address range");
  });

  it("blocks AAAA record fc00::1 (ULA, fc00::/7 lower)", async () => {
    mockLookup.mockResolvedValueOnce([{ address: "fc00::1", family: 6 }] as never);
    await expect(assertSafeUrl("https://ipv6-ula.example.com/hook")).rejects.toThrow("blocked address range");
  });

  it("blocks AAAA record fd00::1 (ULA, fc00::/7 upper)", async () => {
    mockLookup.mockResolvedValueOnce([{ address: "fd00::1", family: 6 }] as never);
    await expect(assertSafeUrl("https://ipv6-ula2.example.com/hook")).rejects.toThrow("blocked address range");
  });

  it("blocks AAAA record ff02::1 (multicast)", async () => {
    mockLookup.mockResolvedValueOnce([{ address: "ff02::1", family: 6 }] as never);
    await expect(assertSafeUrl("https://ipv6-multicast.example.com/hook")).rejects.toThrow("blocked address range");
  });

  it("blocks AAAA record ::ffff:192.168.1.1 (IPv4-mapped private, dotted-decimal)", async () => {
    mockLookup.mockResolvedValueOnce([{ address: "::ffff:192.168.1.1", family: 6 }] as never);
    await expect(assertSafeUrl("https://ipv4-mapped.example.com/hook")).rejects.toThrow("blocked address range");
  });

  it("blocks AAAA record ::ffff:127.0.0.1 (IPv4-mapped loopback, dotted-decimal)", async () => {
    mockLookup.mockResolvedValueOnce([{ address: "::ffff:127.0.0.1", family: 6 }] as never);
    await expect(assertSafeUrl("https://ipv4-loopback-mapped.example.com/hook")).rejects.toThrow("blocked address range");
  });
});

describe("assertSafeUrl — DNS resolution (hostname path)", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    delete process.env.WEBHOOK_HOST_ALLOWLIST;
  });

  afterEach(() => {
    delete process.env.WEBHOOK_HOST_ALLOWLIST;
  });

  it("resolves hostname and accepts a public A-record", async () => {
    mockLookup.mockResolvedValueOnce([{ address: "93.184.216.34", family: 4 }] as never);
    await expect(assertSafeUrl("https://example.com/hook")).resolves.toBeUndefined();
    expect(mockLookup).toHaveBeenCalledWith("example.com", { all: true });
  });

  it("resolves hostname with multiple public A-records — accepts", async () => {
    mockLookup.mockResolvedValueOnce([
      { address: "93.184.216.34", family: 4 },
      { address: "93.184.216.35", family: 4 },
    ] as never);
    await expect(assertSafeUrl("https://example.com/hook")).resolves.toBeUndefined();
  });

  it("blocks when ANY A-record is private, even if others are public (mixed public + private)", async () => {
    mockLookup.mockResolvedValueOnce([
      { address: "93.184.216.34", family: 4 }, // public
      { address: "192.168.1.1", family: 4 }, // private — this single record must block all
    ] as never);
    await expect(assertSafeUrl("https://mixed.example.com/hook")).rejects.toThrow("blocked address range");
  });

  it("blocks when DNS resolves to loopback 127.0.0.1", async () => {
    mockLookup.mockResolvedValueOnce([{ address: "127.0.0.1", family: 4 }] as never);
    await expect(assertSafeUrl("https://evil.example.com/hook")).rejects.toThrow("blocked address range");
  });

  it("blocks when DNS resolves to metadata address 169.254.169.254", async () => {
    mockLookup.mockResolvedValueOnce([{ address: "169.254.169.254", family: 4 }] as never);
    await expect(assertSafeUrl("https://ssrf.evil.com/hook")).rejects.toThrow("blocked address range");
  });

  it("blocks when DNS resolves to 10.x private address", async () => {
    mockLookup.mockResolvedValueOnce([{ address: "10.0.0.1", family: 4 }] as never);
    await expect(assertSafeUrl("https://internal.corp/hook")).rejects.toThrow("blocked address range");
  });

  it("throws when DNS lookup throws (network error / ENOTFOUND)", async () => {
    mockLookup.mockRejectedValueOnce(new Error("ENOTFOUND nonexistent.invalid"));
    await expect(assertSafeUrl("https://nonexistent.invalid/hook")).rejects.toThrow("could not be resolved");
  });

  it("throws when DNS returns an empty address list", async () => {
    mockLookup.mockResolvedValueOnce([] as never);
    await expect(assertSafeUrl("https://empty.example.com/hook")).rejects.toThrow("could not be resolved");
  });
});

describe("assertSafeUrl — WEBHOOK_HOST_ALLOWLIST", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    delete process.env.WEBHOOK_HOST_ALLOWLIST;
  });

  afterEach(() => {
    delete process.env.WEBHOOK_HOST_ALLOWLIST;
  });

  it("when allowlist is set, accepts a host in the list (then DNS resolves fine)", async () => {
    process.env.WEBHOOK_HOST_ALLOWLIST = "trusted.example.com,other.example.com";
    mockLookup.mockResolvedValueOnce([{ address: "93.184.216.34", family: 4 }] as never);
    await expect(assertSafeUrl("https://trusted.example.com/hook")).resolves.toBeUndefined();
  });

  it("when allowlist is set, blocks a host NOT in the list", async () => {
    process.env.WEBHOOK_HOST_ALLOWLIST = "trusted.example.com";
    await expect(assertSafeUrl("https://other.example.com/hook")).rejects.toThrow("not in the allow-list");
  });

  it("normalizes allowlist entries: trims whitespace and lowercases", async () => {
    process.env.WEBHOOK_HOST_ALLOWLIST = "  Trusted.Example.Com  ,  Other.Com  ";
    mockLookup.mockResolvedValueOnce([{ address: "93.184.216.34", family: 4 }] as never);
    await expect(assertSafeUrl("https://trusted.example.com/hook")).resolves.toBeUndefined();
  });

  it("when allowlist is empty string, behaves as no allowlist (all hosts allowed subject to IP check)", async () => {
    process.env.WEBHOOK_HOST_ALLOWLIST = "";
    mockLookup.mockResolvedValueOnce([{ address: "93.184.216.34", family: 4 }] as never);
    await expect(assertSafeUrl("https://any-host.example.com/hook")).resolves.toBeUndefined();
  });

  it("blocked IP literal is still blocked even if it appears in the allowlist", async () => {
    // The allowlist is checked by hostname; the IP block check runs AFTER and still fires.
    process.env.WEBHOOK_HOST_ALLOWLIST = "127.0.0.1";
    await expect(assertSafeUrl("https://127.0.0.1/hook")).rejects.toThrow("blocked address range");
  });

  it("without allowlist, any public hostname resolves and is accepted", async () => {
    mockLookup.mockResolvedValueOnce([{ address: "93.184.216.34", family: 4 }] as never);
    await expect(assertSafeUrl("https://random-public-service.io/hook")).resolves.toBeUndefined();
  });
});

describe("assertSafeUrl — defensive fail-closed + public IPv6 accept", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    delete process.env.WEBHOOK_HOST_ALLOWLIST;
  });
  afterEach(() => {
    delete process.env.WEBHOOK_HOST_ALLOWLIST;
  });

  it("fails closed when DNS returns a non-parseable address (isIP === 0)", async () => {
    // A malformed A/AAAA record must be rejected, not silently accepted
    // (isBlockedAddress fail-closed default at family === 0).
    mockLookup.mockResolvedValueOnce([{ address: "garbage-not-ip", family: 4 }] as never);
    await expect(assertSafeUrl("https://malformed-dns.example.com/hook")).rejects.toThrow(
      "blocked address range"
    );
  });

  it("accepts a hostname resolving to a public IPv6 (AAAA) address", async () => {
    mockLookup.mockResolvedValueOnce([
      { address: "2606:2800:220:1:248:1893:25c8:1946", family: 6 },
    ] as never);
    await expect(assertSafeUrl("https://ipv6-public.example.com/hook")).resolves.toBeUndefined();
  });
});
