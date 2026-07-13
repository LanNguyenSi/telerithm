import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { createChildLogger } from "../../logger.js";

const log = createChildLogger("notify-url-guard");

/**
 * SSRF guard for user-supplied webhook URLs (WEBHOOK / SLACK / MSTEAMS).
 *
 * Outbound notification targets are attacker-controlled (created via the
 * subscription API and triggerable through POST /subscriptions/:id/test), so
 * an unvalidated URL would let a caller reach internal services, the cloud
 * metadata endpoint (169.254.169.254), or loopback ports. This helper:
 *   - rejects any non-http(s) scheme,
 *   - resolves the hostname and rejects every resolved address that falls in a
 *     private / loopback / link-local / ULA / unspecified / metadata range,
 *   - optionally restricts delivery to an env allow-list of hosts,
 *   - optionally decodes IPv4 addresses embedded via operator-specific NAT64
 *     prefixes (see WEBHOOK_NAT64_ADDITIONAL_PREFIXES / envNat64Prefixes).
 *
 * It must be called BOTH at the input boundary (subscription create/update)
 * and again immediately before each fetch (defense in depth, since DNS can be
 * rebound between persistence and delivery). Callers should additionally use
 * `redirect: "manual"` on the fetch so a 3xx cannot bounce to a blocked host.
 */

function envAllowlist(): string[] {
  const raw = process.env.WEBHOOK_HOST_ALLOWLIST;
  if (!raw) return [];
  return raw
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter((h) => h.length > 0);
}

function ipToBytes(ip: string): number[] | null {
  const family = isIP(ip);
  if (family === 4) {
    const parts = ip.split(".").map((p) => Number(p));
    if (parts.length !== 4 || parts.some((p) => Number.isNaN(p) || p < 0 || p > 255)) return null;
    return parts;
  }
  return null;
}

/**
 * Additional NAT64 /96 prefixes (besides the RFC 6052 well-known
 * 64:ff9b::/96, which isBlockedAddress always decodes) whose embedded IPv4
 * address should also be decoded and range-checked. Real NAT64 deployments
 * often run on a Network-Specific Prefix from their own allocation, or on
 * the RFC 8215 local-use prefix 64:ff9b:1::/48; both are deployment-specific,
 * so neither is hardcoded, opt in per deployment via this env var instead.
 *
 * WEBHOOK_NAT64_ADDITIONAL_PREFIXES: comma-separated list of /96 prefixes,
 * each written as the fixed 96-bit head in RFC 5952 canonical (lowercase,
 * "::"-compressed) form, e.g. "64:ff9b:1::,2001:db8:64::". Entries that do
 * not end in "::" are dropped (fail closed against a malformed entry
 * silently over-matching via a plain string prefix, e.g. "64:ff9b:1"
 * matching "64:ff9b:123::..." too). Empty by default: additional prefixes
 * are NOT decoded unless explicitly configured. Only /96-length prefixes are
 * supported here: shorter RFC 6052 prefix lengths (/32, /40, /48, /56,
 * /64) interleave a reserved "u" octet with the v4 bits and need a different
 * decoder; deployments using those lengths are not covered by this guard.
 */
function envNat64Prefixes(): string[] {
  const raw = process.env.WEBHOOK_NAT64_ADDITIONAL_PREFIXES;
  if (!raw) return [];
  return raw
    .split(",")
    .map((p) => p.trim().toLowerCase())
    .filter((p) => p.length > 0 && p.endsWith("::"));
}

/**
 * True if the address is in a private, loopback, link-local, ULA, or
 * metadata range.
 *
 * Also decodes and re-checks IPv4 addresses embedded in IPv6 via:
 *   - IPv4-mapped (::ffff:a.b.c.d and its hex-compressed form),
 *   - NAT64 (64:ff9b::/96 well-known prefix, RFC 6052 sec 2.1, plus any
 *     operator-specific /96 prefixes from WEBHOOK_NAT64_ADDITIONAL_PREFIXES,
 *     see envNat64Prefixes),
 *   - 6to4 (2002::/16, RFC 3056),
 *   - Teredo (2001:0::/32, RFC 4380: the client v4 is bit-inverted on the
 *     wire and is un-inverted before the range check),
 *   - the deprecated IPv4-compatible form (::a.b.c.d).
 * For the NAT64 and IPv4-compatible forms, an embedded v4 whose first two
 * octets are both zero collapses under RFC 5952 canonical compression to a
 * single trailing hex group (64:ff9b::0.0.1.2 canonicalises to
 * 64:ff9b::102, ::0.0.0.5 to ::5); that single-group form is decoded too.
 * 6to4 is unaffected by that collapse since the literal "2002:" prefix keeps
 * the leading zero group from ever joining the "::" run.
 *
 * Assumes `ip` is already a canonical/normalised IP string (the form
 * `net.isIP` accepts and DNS resolvers / the WHATWG URL parser hand back),
 * not raw user input — callers must not skip that normalisation.
 */
function isBlockedAddress(ip: string): boolean {
  const family = isIP(ip);
  if (family === 0) return true; // not a parseable IP, fail closed

  if (family === 4) {
    const bytes = ipToBytes(ip);
    if (!bytes) return true;
    const [a, b] = bytes;
    if (a === 0) return true; // 0.0.0.0/8 (incl. unspecified)
    if (a === 10) return true; // 10.0.0.0/8
    if (a === 127) return true; // 127.0.0.0/8 loopback
    if (a === 169 && b === 254) return true; // 169.254.0.0/16 link-local + cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
    if (a === 192 && b === 168) return true; // 192.168.0.0/16
    if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 CGNAT
    if (a >= 224) return true; // multicast / reserved
    return false;
  }

  // IPv6
  const v6 = ip.toLowerCase();
  if (v6 === "::" || v6 === "::1") return true; // unspecified / loopback
  // IPv4-mapped (::ffff:a.b.c.d): re-check the embedded v4 address.
  const mapped = v6.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isBlockedAddress(mapped[1]);
  // IPv4-mapped in compressed-hex form (::ffff:a00:1 == 10.0.0.1): the WHATWG
  // URL parser and resolvers normalise the dotted form away, so convert the
  // two hex groups back to dotted decimal and re-check the embedded ranges.
  const hexMapped = v6.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (hexMapped) {
    const hi = parseInt(hexMapped[1], 16);
    const lo = parseInt(hexMapped[2], 16);
    return isBlockedAddress(`${hi >> 8}.${hi & 0xff}.${lo >> 8}.${lo & 0xff}`);
  }
  // NAT64 (64:ff9b::/96, RFC 6052): the low 32 bits are the embedded IPv4
  // address. Accept both the dotted-quad and hex-compressed spellings, since
  // resolvers/normalisers may hand back either.
  const nat64Dotted = v6.match(/^64:ff9b::(\d+\.\d+\.\d+\.\d+)$/);
  if (nat64Dotted) return isBlockedAddress(nat64Dotted[1]);
  const nat64Hex = v6.match(/^64:ff9b::([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (nat64Hex) {
    const hi = parseInt(nat64Hex[1], 16);
    const lo = parseInt(nat64Hex[2], 16);
    return isBlockedAddress(`${hi >> 8}.${hi & 0xff}.${lo >> 8}.${lo & 0xff}`);
  }
  // NAT64 single-group collapse: when the embedded v4's first two octets are
  // both zero, RFC 5952 compression swallows the (otherwise all-zero) high
  // group into the leading "::", leaving only the low group
  // (64:ff9b::0.0.1.2 canonicalises to 64:ff9b::102). Only 0.0.0.0/8 can ever
  // appear here (RFC 6052 excludes it from NAT64 use, and it is already
  // blocked below regardless), so this branch only ever confirms a block.
  const nat64Single = v6.match(/^64:ff9b::([0-9a-f]{1,4})$/);
  if (nat64Single) {
    const lo = parseInt(nat64Single[1], 16);
    return isBlockedAddress(`0.0.${lo >> 8}.${lo & 0xff}`);
  }
  // Operator-specific NAT64 /96 prefixes (Network-Specific Prefix, RFC 6052
  // sec 2.1, or the RFC 8215 local-use prefix 64:ff9b:1::/48): not hardcoded
  // since they are deployment-specific, see envNat64Prefixes. No-op (empty
  // loop) unless WEBHOOK_NAT64_ADDITIONAL_PREFIXES is set.
  for (const prefix of envNat64Prefixes()) {
    if (!v6.startsWith(prefix)) continue;
    const suffix = v6.slice(prefix.length);
    const dotted = suffix.match(/^(\d+\.\d+\.\d+\.\d+)$/);
    if (dotted) return isBlockedAddress(dotted[1]);
    const twoGroups = suffix.match(/^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
    if (twoGroups) {
      const hi = parseInt(twoGroups[1], 16);
      const lo = parseInt(twoGroups[2], 16);
      return isBlockedAddress(`${hi >> 8}.${hi & 0xff}.${lo >> 8}.${lo & 0xff}`);
    }
    const oneGroup = suffix.match(/^([0-9a-f]{1,4})$/);
    if (oneGroup) {
      const lo = parseInt(oneGroup[1], 16);
      return isBlockedAddress(`0.0.${lo >> 8}.${lo & 0xff}`);
    }
  }
  // 6to4 (2002::/16, RFC 3056): the 32 bits immediately after the 2002
  // prefix are the embedded IPv4 address, regardless of the SLA ID /
  // interface-identifier bits that follow. The literal "2002:" prefix keeps
  // this form out of the single-group collapse above (a leading zero group
  // can never join the "::" run), so no extra form is needed here.
  const sixToFour = v6.match(/^2002:([0-9a-f]{1,4}):([0-9a-f]{1,4})(:|$)/);
  if (sixToFour) {
    const hi = parseInt(sixToFour[1], 16);
    const lo = parseInt(sixToFour[2], 16);
    return isBlockedAddress(`${hi >> 8}.${hi & 0xff}.${lo >> 8}.${lo & 0xff}`);
  }
  // Teredo (2001:0::/32, RFC 4380): groups 3-4 are the Teredo server's IPv4
  // address, group 5 is flags, group 6 is the obfuscated UDP port, and
  // groups 7-8 are the CLIENT's IPv4 address, bit-inverted (XOR 0xffffffff,
  // i.e. one's complement) on the wire, un-invert it before the range
  // check. The lone "0" in "2001:0:" is never compressed by itself (RFC 5952
  // forbids "::" for a single zero group), so the explicit 8-group form
  // below covers every real-world Teredo address. The one theoretical
  // exception, flags and obfuscated port both exactly 0x0000 (an adjacent
  // zero-pair that WOULD compress), is accepted as negligible: it requires
  // flags 0 and true client port 65535, not seen in real deployments.
  const teredo = v6.match(
    /^2001:0:[0-9a-f]{1,4}:[0-9a-f]{1,4}:[0-9a-f]{1,4}:[0-9a-f]{1,4}:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/,
  );
  if (teredo) {
    const hi = parseInt(teredo[1], 16) ^ 0xffff;
    const lo = parseInt(teredo[2], 16) ^ 0xffff;
    return isBlockedAddress(`${hi >> 8}.${hi & 0xff}.${lo >> 8}.${lo & 0xff}`);
  }
  // IPv4-compatible (::a.b.c.d, deprecated RFC 4291 form, no "ffff" marker):
  // the low 32 bits are the embedded IPv4 address. Accept both the
  // dotted-quad and hex-compressed spellings (::c0a8:101 == ::192.168.1.1).
  // This intentionally does not match the "::ffff:..." mapped forms above,
  // which are handled (and already returned) by the two branches before it.
  const v4CompatDotted = v6.match(/^::(\d+\.\d+\.\d+\.\d+)$/);
  if (v4CompatDotted) return isBlockedAddress(v4CompatDotted[1]);
  const v4CompatHex = v6.match(/^::([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (v4CompatHex) {
    const hi = parseInt(v4CompatHex[1], 16);
    const lo = parseInt(v4CompatHex[2], 16);
    return isBlockedAddress(`${hi >> 8}.${hi & 0xff}.${lo >> 8}.${lo & 0xff}`);
  }
  // IPv4-compatible single-group collapse (::0.0.0.5 canonicalises to ::5),
  // same reasoning as the NAT64 single-group form above: only 0.0.0.0/8 can
  // land here, which is already blocked below, so this only confirms a
  // block. This intentionally also swallows other short "::N" addresses that
  // are not really IPv4-compatible embeddings (e.g. "::ffff" alone, distinct
  // from the "::ffff:" mapped-prefix forms handled above): every such
  // address falls in the IETF-reserved 0000::/8 block, which is never
  // globally routable, so treating it as blocked cannot over-block real
  // public traffic.
  const v4CompatSingle = v6.match(/^::([0-9a-f]{1,4})$/);
  if (v4CompatSingle) {
    const lo = parseInt(v4CompatSingle[1], 16);
    return isBlockedAddress(`0.0.${lo >> 8}.${lo & 0xff}`);
  }
  if (v6.startsWith("fe80")) return true; // link-local
  if (v6.startsWith("fc") || v6.startsWith("fd")) return true; // fc00::/7 ULA
  if (v6.startsWith("ff")) return true; // multicast
  return false;
}

/**
 * Validate that `rawUrl` is a safe outbound webhook target. Throws on any
 * violation so callers fail closed.
 */
export async function assertSafeUrl(rawUrl: string): Promise<void> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error("Invalid webhook URL");
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error(`Unsupported webhook scheme: ${parsed.protocol}`);
  }

  const host = parsed.hostname.toLowerCase();
  if (host.length === 0) {
    throw new Error("Webhook URL has no host");
  }

  const allowlist = envAllowlist();
  if (allowlist.length > 0 && !allowlist.includes(host)) {
    throw new Error("Webhook host is not in the allow-list");
  }

  // WHATWG URL keeps the brackets on IPv6 literal hostnames ("[::1]"), which
  // isIP does not accept; strip one surrounding pair so IPv6 literals hit the
  // real range check below instead of being "blocked" only by a failing DNS
  // lookup.
  const bareHost = host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;

  // If the host is a literal IP, check it directly. Otherwise resolve all
  // addresses and reject if ANY of them is blocked (avoids a partial-block
  // bypass where one A record is public and another is private).
  if (isIP(bareHost) !== 0) {
    if (isBlockedAddress(bareHost)) {
      throw new Error("Webhook host resolves to a blocked address range");
    }
    return;
  }

  let addresses: { address: string }[];
  try {
    addresses = await lookup(bareHost, { all: true });
  } catch {
    throw new Error("Webhook host could not be resolved");
  }

  if (addresses.length === 0) {
    throw new Error("Webhook host could not be resolved");
  }

  for (const { address } of addresses) {
    if (isBlockedAddress(address)) {
      log.warn({ host, address }, "Blocked webhook target in private/metadata range");
      throw new Error("Webhook host resolves to a blocked address range");
    }
  }
}
