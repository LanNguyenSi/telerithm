/**
 * Unit tests for the SSRF guard: assertSafeUrl.
 *
 * Implementation note — Node.js URL.hostname and IPv6 brackets:
 *   Node.js's WHATWG URL implementation preserves brackets when serialising
 *   IPv6 hostnames, so `new URL("https://[::1]/hook").hostname` returns
 *   "[::1]", not "::1". assertSafeUrl strips one surrounding bracket pair
 *   before isIP, so IPv6 literal URLs take the literal-IP branch and are
 *   rejected by the range check itself (task 2830e452; previously they were
 *   only blocked as a side effect of DNS failing on the bracketed name).
 *
 *   IPv6 addresses returned BY DNS (without brackets, e.g. from AAAA records)
 *   are checked by isBlockedAddress, including the hex IPv4-mapped form
 *   (::ffff:a00:1) that resolvers and the URL parser normalise to.
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
 *   Node.js preserves brackets in URL.hostname for IPv6 ("[::1]").
 *   assertSafeUrl strips one surrounding bracket pair before isIP, so these
 *   literals are rejected by the real IP-range check ("blocked address
 *   range") with NO DNS involved — mockLookup stays uncalled. Previously they
 *   were only blocked as a side effect of DNS failing on the bracketed name.
 */
describe("assertSafeUrl — IPv6 literal URLs (blocked via IP-range check, no DNS)", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    delete process.env.WEBHOOK_HOST_ALLOWLIST;
  });

  afterEach(() => {
    delete process.env.WEBHOOK_HOST_ALLOWLIST;
  });

  it("blocks https://[::1] (IPv6 loopback) via the range check without DNS", async () => {
    await expect(assertSafeUrl("https://[::1]/hook")).rejects.toThrow("blocked address range");
    expect(mockLookup).not.toHaveBeenCalled();
  });

  it("blocks https://[::] (IPv6 unspecified)", async () => {
    await expect(assertSafeUrl("https://[::]/hook")).rejects.toThrow("blocked address range");
  });

  it("blocks https://[fe80::1] (IPv6 link-local)", async () => {
    await expect(assertSafeUrl("https://[fe80::1]/hook")).rejects.toThrow("blocked address range");
  });

  it("blocks https://[fc00::1] (IPv6 ULA)", async () => {
    await expect(assertSafeUrl("https://[fc00::1]/hook")).rejects.toThrow("blocked address range");
  });

  it("blocks https://[fd00::1] (IPv6 ULA)", async () => {
    await expect(assertSafeUrl("https://[fd00::1]/hook")).rejects.toThrow("blocked address range");
  });

  it("blocks https://[ff02::1] (IPv6 multicast)", async () => {
    await expect(assertSafeUrl("https://[ff02::1]/hook")).rejects.toThrow("blocked address range");
  });

  it("blocks https://[::ffff:192.168.1.1] (IPv4-mapped literal; URL normalises it to hex form)", async () => {
    // new URL(...) rewrites the hostname to "[::ffff:c0a8:101]", so this
    // exercises the hex IPv4-mapped branch end-to-end.
    await expect(assertSafeUrl("https://[::ffff:192.168.1.1]/hook")).rejects.toThrow("blocked address range");
    expect(mockLookup).not.toHaveBeenCalled();
  });

  it("accepts https://[public-v6]/ (public IPv6 literal) via the range check without DNS", async () => {
    await expect(assertSafeUrl("https://[2606:2800:220:1:248:1893:25c8:1946]/hook")).resolves.toBeUndefined();
    expect(mockLookup).not.toHaveBeenCalled();
  });
});

/**
 * Hex-form IPv4-mapped IPv6 (::ffff:a00:1 == 10.0.0.1): resolvers and the
 * WHATWG URL parser normalise the dotted-decimal form away, so the guard must
 * decode the two hex groups back to IPv4 and re-check the embedded ranges.
 */
describe("assertSafeUrl — hex IPv4-mapped IPv6 (AAAA records)", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    delete process.env.WEBHOOK_HOST_ALLOWLIST;
  });

  afterEach(() => {
    delete process.env.WEBHOOK_HOST_ALLOWLIST;
  });

  it("blocks AAAA record ::ffff:c0a8:101 (192.168.1.1)", async () => {
    mockLookup.mockResolvedValueOnce([{ address: "::ffff:c0a8:101", family: 6 }] as never);
    await expect(assertSafeUrl("https://hexmapped.example.com/hook")).rejects.toThrow(
      "blocked address range",
    );
  });

  it("blocks AAAA record ::ffff:7f00:1 (127.0.0.1)", async () => {
    mockLookup.mockResolvedValueOnce([{ address: "::ffff:7f00:1", family: 6 }] as never);
    await expect(assertSafeUrl("https://hexmapped.example.com/hook")).rejects.toThrow(
      "blocked address range",
    );
  });

  it("blocks AAAA record ::ffff:a00:1 (10.0.0.1)", async () => {
    mockLookup.mockResolvedValueOnce([{ address: "::ffff:a00:1", family: 6 }] as never);
    await expect(assertSafeUrl("https://hexmapped.example.com/hook")).rejects.toThrow(
      "blocked address range",
    );
  });

  it("does NOT over-block a public hex IPv4-mapped address (::ffff:808:808 = 8.8.8.8)", async () => {
    mockLookup.mockResolvedValueOnce([{ address: "::ffff:808:808", family: 6 }] as never);
    await expect(assertSafeUrl("https://hexmapped.example.com/hook")).resolves.toBeUndefined();
  });

  it("still fails closed when DNS cannot resolve a hostname", async () => {
    mockDnsFail();
    await expect(assertSafeUrl("https://unresolvable.example.com/hook")).rejects.toThrow(
      "could not be resolved",
    );
  });
});

/**
 * Non-::ffff IPv4-in-IPv6 embeddings: NAT64 (64:ff9b::/96), 6to4 (2002::/16),
 * and the deprecated IPv4-compatible form (::a.b.c.d). isBlockedAddress must
 * decode the embedded v4 address out of each of these and re-check it,
 * otherwise a private v4 target can be smuggled past the guard as a AAAA
 * record in one of these forms (task 6a363c72; found in review of task
 * 2830e452 / PR #99, which only closed the ::ffff-hex + bracketed-literal
 * gaps).
 */
describe("assertSafeUrl — non-::ffff IPv4-in-IPv6 embeddings (AAAA records)", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    delete process.env.WEBHOOK_HOST_ALLOWLIST;
  });

  afterEach(() => {
    delete process.env.WEBHOOK_HOST_ALLOWLIST;
  });

  it("blocks NAT64 64:ff9b::c0a8:101 (embedded 192.168.1.1)", async () => {
    mockLookup.mockResolvedValueOnce([{ address: "64:ff9b::c0a8:101", family: 6 }] as never);
    await expect(assertSafeUrl("https://nat64.example.com/hook")).rejects.toThrow("blocked address range");
  });

  it("blocks NAT64 64:ff9b::10.0.0.1 (dotted-quad embedded form, 10.0.0.1)", async () => {
    mockLookup.mockResolvedValueOnce([{ address: "64:ff9b::10.0.0.1", family: 6 }] as never);
    await expect(assertSafeUrl("https://nat64-dotted.example.com/hook")).rejects.toThrow(
      "blocked address range",
    );
  });

  it("does NOT over-block NAT64 64:ff9b::808:808 (embedded public 8.8.8.8)", async () => {
    mockLookup.mockResolvedValueOnce([{ address: "64:ff9b::808:808", family: 6 }] as never);
    await expect(assertSafeUrl("https://nat64-public.example.com/hook")).resolves.toBeUndefined();
  });

  it("blocks 6to4 2002:c0a8:101:: (embedded 192.168.1.1)", async () => {
    mockLookup.mockResolvedValueOnce([{ address: "2002:c0a8:101::", family: 6 }] as never);
    await expect(assertSafeUrl("https://sixtofour.example.com/hook")).rejects.toThrow(
      "blocked address range",
    );
  });

  it("blocks 6to4 2002:7f00:1:: (embedded loopback 127.0.0.1)", async () => {
    mockLookup.mockResolvedValueOnce([{ address: "2002:7f00:1::", family: 6 }] as never);
    await expect(assertSafeUrl("https://sixtofour-loopback.example.com/hook")).rejects.toThrow(
      "blocked address range",
    );
  });

  it("does NOT over-block 6to4 2002:808:808:: (embedded public 8.8.8.8)", async () => {
    mockLookup.mockResolvedValueOnce([{ address: "2002:808:808::", family: 6 }] as never);
    await expect(assertSafeUrl("https://sixtofour-public.example.com/hook")).resolves.toBeUndefined();
  });

  it("blocks IPv4-compatible ::c0a8:101 (hex form, embedded 192.168.1.1)", async () => {
    mockLookup.mockResolvedValueOnce([{ address: "::c0a8:101", family: 6 }] as never);
    await expect(assertSafeUrl("https://v4compat-hex.example.com/hook")).rejects.toThrow(
      "blocked address range",
    );
  });

  it("blocks IPv4-compatible ::10.0.0.1 (dotted form, embedded 10.0.0.1)", async () => {
    mockLookup.mockResolvedValueOnce([{ address: "::10.0.0.1", family: 6 }] as never);
    await expect(assertSafeUrl("https://v4compat-dotted.example.com/hook")).rejects.toThrow(
      "blocked address range",
    );
  });

  it("does NOT over-block IPv4-compatible ::808:808 (embedded public 8.8.8.8)", async () => {
    mockLookup.mockResolvedValueOnce([{ address: "::808:808", family: 6 }] as never);
    await expect(assertSafeUrl("https://v4compat-public.example.com/hook")).resolves.toBeUndefined();
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
    await expect(assertSafeUrl("https://ipv6-loopback.example.com/hook")).rejects.toThrow(
      "blocked address range",
    );
  });

  it("blocks AAAA record :: (unspecified)", async () => {
    mockLookup.mockResolvedValueOnce([{ address: "::", family: 6 }] as never);
    await expect(assertSafeUrl("https://ipv6-unspecified.example.com/hook")).rejects.toThrow(
      "blocked address range",
    );
  });

  it("blocks AAAA record fe80::1 (link-local)", async () => {
    mockLookup.mockResolvedValueOnce([{ address: "fe80::1", family: 6 }] as never);
    await expect(assertSafeUrl("https://ipv6-link-local.example.com/hook")).rejects.toThrow(
      "blocked address range",
    );
  });

  it("blocks AAAA record fc00::1 (ULA, fc00::/7 lower)", async () => {
    mockLookup.mockResolvedValueOnce([{ address: "fc00::1", family: 6 }] as never);
    await expect(assertSafeUrl("https://ipv6-ula.example.com/hook")).rejects.toThrow("blocked address range");
  });

  it("blocks AAAA record fd00::1 (ULA, fc00::/7 upper)", async () => {
    mockLookup.mockResolvedValueOnce([{ address: "fd00::1", family: 6 }] as never);
    await expect(assertSafeUrl("https://ipv6-ula2.example.com/hook")).rejects.toThrow(
      "blocked address range",
    );
  });

  it("blocks AAAA record ff02::1 (multicast)", async () => {
    mockLookup.mockResolvedValueOnce([{ address: "ff02::1", family: 6 }] as never);
    await expect(assertSafeUrl("https://ipv6-multicast.example.com/hook")).rejects.toThrow(
      "blocked address range",
    );
  });

  it("blocks AAAA record ::ffff:192.168.1.1 (IPv4-mapped private, dotted-decimal)", async () => {
    mockLookup.mockResolvedValueOnce([{ address: "::ffff:192.168.1.1", family: 6 }] as never);
    await expect(assertSafeUrl("https://ipv4-mapped.example.com/hook")).rejects.toThrow(
      "blocked address range",
    );
  });

  it("blocks AAAA record ::ffff:127.0.0.1 (IPv4-mapped loopback, dotted-decimal)", async () => {
    mockLookup.mockResolvedValueOnce([{ address: "::ffff:127.0.0.1", family: 6 }] as never);
    await expect(assertSafeUrl("https://ipv4-loopback-mapped.example.com/hook")).rejects.toThrow(
      "blocked address range",
    );
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
      "blocked address range",
    );
  });

  it("accepts a hostname resolving to a public IPv6 (AAAA) address", async () => {
    mockLookup.mockResolvedValueOnce([{ address: "2606:2800:220:1:248:1893:25c8:1946", family: 6 }] as never);
    await expect(assertSafeUrl("https://ipv6-public.example.com/hook")).resolves.toBeUndefined();
  });
});

/**
 * SSRF residuals surfaced by review of PR #103 (task b5829887): the 0.0.x.x
 * single-group collapse (NAT64 + IPv4-compatible), operator-specific NAT64
 * prefixes, and Teredo. See the comments above isBlockedAddress in
 * url-guard.ts for the RFC references and decode reasoning.
 */
describe("assertSafeUrl — 0.0.x.x single-group collapse (RFC 5952 compression)", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    delete process.env.WEBHOOK_HOST_ALLOWLIST;
  });
  afterEach(() => {
    delete process.env.WEBHOOK_HOST_ALLOWLIST;
  });

  it("blocks NAT64 single-group 64:ff9b::1 (embedded 0.0.0.1, collapse of 64:ff9b::0.0.0.1)", async () => {
    mockLookup.mockResolvedValueOnce([{ address: "64:ff9b::1", family: 6 }] as never);
    await expect(assertSafeUrl("https://nat64-single.example.com/hook")).rejects.toThrow(
      "blocked address range",
    );
  });

  it("blocks NAT64 single-group 64:ff9b::102 (embedded 0.0.1.2, collapse of 64:ff9b::0.0.1.2)", async () => {
    mockLookup.mockResolvedValueOnce([{ address: "64:ff9b::102", family: 6 }] as never);
    await expect(assertSafeUrl("https://nat64-single2.example.com/hook")).rejects.toThrow(
      "blocked address range",
    );
  });

  it("blocks IPv4-compatible single-group ::5 (embedded 0.0.0.5, collapse of ::0.0.0.5)", async () => {
    mockLookup.mockResolvedValueOnce([{ address: "::5", family: 6 }] as never);
    await expect(assertSafeUrl("https://v4compat-single.example.com/hook")).rejects.toThrow(
      "blocked address range",
    );
  });

  it("blocks IPv4-compatible single-group ::102 (embedded 0.0.1.2, collapse of ::0.0.1.2)", async () => {
    mockLookup.mockResolvedValueOnce([{ address: "::102", family: 6 }] as never);
    await expect(assertSafeUrl("https://v4compat-single2.example.com/hook")).rejects.toThrow(
      "blocked address range",
    );
  });

  it("does NOT match an unrelated prefix that merely starts like the well-known NAT64 prefix (64:ff9b:1::1, no additional prefix configured)", async () => {
    // "64:ff9b:1::1" is NOT "64:ff9b::1": the well-known-prefix regex is
    // anchored to exactly "64:ff9b::" and must not over-match this. Without
    // WEBHOOK_NAT64_ADDITIONAL_PREFIXES configured, this AAAA record is not
    // decoded at all and is treated as an ordinary (accepted) IPv6 address.
    mockLookup.mockResolvedValueOnce([{ address: "64:ff9b:1::1", family: 6 }] as never);
    await expect(assertSafeUrl("https://nat64-lookalike.example.com/hook")).resolves.toBeUndefined();
  });
});

describe("assertSafeUrl — operator-specific NAT64 prefixes (WEBHOOK_NAT64_ADDITIONAL_PREFIXES)", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    delete process.env.WEBHOOK_HOST_ALLOWLIST;
    delete process.env.WEBHOOK_NAT64_ADDITIONAL_PREFIXES;
  });
  afterEach(() => {
    delete process.env.WEBHOOK_HOST_ALLOWLIST;
    delete process.env.WEBHOOK_NAT64_ADDITIONAL_PREFIXES;
  });

  it("blocks a configured prefix embedding a private address (hex form, 192.168.1.1)", async () => {
    process.env.WEBHOOK_NAT64_ADDITIONAL_PREFIXES = "64:ff9b:1::,2001:db8:64::";
    mockLookup.mockResolvedValueOnce([{ address: "64:ff9b:1::c0a8:101", family: 6 }] as never);
    await expect(assertSafeUrl("https://nsp-private.example.com/hook")).rejects.toThrow(
      "blocked address range",
    );
  });

  it("blocks a configured prefix embedding loopback (dotted form, 127.0.0.1)", async () => {
    process.env.WEBHOOK_NAT64_ADDITIONAL_PREFIXES = "64:ff9b:1::,2001:db8:64::";
    mockLookup.mockResolvedValueOnce([{ address: "2001:db8:64::127.0.0.1", family: 6 }] as never);
    await expect(assertSafeUrl("https://nsp-loopback.example.com/hook")).rejects.toThrow(
      "blocked address range",
    );
  });

  it("blocks a configured prefix embedding the 0.0.x.x single-group collapse (0.0.0.5)", async () => {
    process.env.WEBHOOK_NAT64_ADDITIONAL_PREFIXES = "64:ff9b:1::";
    mockLookup.mockResolvedValueOnce([{ address: "64:ff9b:1::5", family: 6 }] as never);
    await expect(assertSafeUrl("https://nsp-single.example.com/hook")).rejects.toThrow(
      "blocked address range",
    );
  });

  it("does NOT over-block a configured prefix embedding a public address (8.8.8.8)", async () => {
    process.env.WEBHOOK_NAT64_ADDITIONAL_PREFIXES = "64:ff9b:1::,2001:db8:64::";
    mockLookup.mockResolvedValueOnce([{ address: "64:ff9b:1::808:808", family: 6 }] as never);
    await expect(assertSafeUrl("https://nsp-public.example.com/hook")).resolves.toBeUndefined();
  });

  it("normalizes prefix list entries: trims whitespace and lowercases", async () => {
    process.env.WEBHOOK_NAT64_ADDITIONAL_PREFIXES = "  64:FF9B:1::  ";
    mockLookup.mockResolvedValueOnce([{ address: "64:ff9b:1::c0a8:101", family: 6 }] as never);
    await expect(assertSafeUrl("https://nsp-normalize.example.com/hook")).rejects.toThrow(
      "blocked address range",
    );
  });

  it("ignores a malformed prefix entry that does not end in '::' (fails closed to not-decoded, not a crash)", async () => {
    // "64:ff9b:1" without the trailing "::" is dropped by envNat64Prefixes,
    // so this AAAA record is not decoded via the additional-prefix path,
    // same (documented) residual as leaving the env var unset entirely.
    process.env.WEBHOOK_NAT64_ADDITIONAL_PREFIXES = "64:ff9b:1";
    mockLookup.mockResolvedValueOnce([{ address: "64:ff9b:1::c0a8:101", family: 6 }] as never);
    await expect(assertSafeUrl("https://nsp-malformed.example.com/hook")).resolves.toBeUndefined();
  });

  it("does NOT decode an operator-specific prefix when WEBHOOK_NAT64_ADDITIONAL_PREFIXES is unset (documented default)", async () => {
    mockLookup.mockResolvedValueOnce([{ address: "64:ff9b:1::c0a8:101", family: 6 }] as never);
    await expect(assertSafeUrl("https://nsp-unset.example.com/hook")).resolves.toBeUndefined();
  });
});

describe("assertSafeUrl — Teredo (2001:0::/32, RFC 4380, client v4 bit-inverted)", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    delete process.env.WEBHOOK_HOST_ALLOWLIST;
  });
  afterEach(() => {
    delete process.env.WEBHOOK_HOST_ALLOWLIST;
  });

  // Groups 3-6 (server v4 "c000:237", flags "0", obfuscated port "1") are
  // arbitrary, isBlockedAddress ignores them and only decodes groups 7-8.
  // Groups 7-8 are the client v4 XORed with 0xffffffff (equivalently, each
  // 16-bit half XORed with 0xffff):
  //   10.0.0.1  -> hi 0x0a00^0xffff=0xf5ff, lo 0x0001^0xffff=0xfffe
  //   127.0.0.1 -> hi 0x7f00^0xffff=0x80ff, lo 0x0001^0xffff=0xfffe
  //   8.8.8.8   -> hi 0x0808^0xffff=0xf7f7, lo 0x0808^0xffff=0xf7f7

  it("blocks Teredo embedding a private client address (10.0.0.1)", async () => {
    mockLookup.mockResolvedValueOnce([{ address: "2001:0:c000:237:0:1:f5ff:fffe", family: 6 }] as never);
    await expect(assertSafeUrl("https://teredo-private.example.com/hook")).rejects.toThrow(
      "blocked address range",
    );
  });

  it("blocks Teredo embedding a loopback client address (127.0.0.1)", async () => {
    mockLookup.mockResolvedValueOnce([{ address: "2001:0:c000:237:0:1:80ff:fffe", family: 6 }] as never);
    await expect(assertSafeUrl("https://teredo-loopback.example.com/hook")).rejects.toThrow(
      "blocked address range",
    );
  });

  it("does NOT over-block Teredo embedding a public client address (8.8.8.8)", async () => {
    mockLookup.mockResolvedValueOnce([{ address: "2001:0:c000:237:0:1:f7f7:f7f7", family: 6 }] as never);
    await expect(assertSafeUrl("https://teredo-public.example.com/hook")).resolves.toBeUndefined();
  });
});
