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
 *   - optionally restricts delivery to an env allow-list of hosts.
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

/** True if the address is in a private, loopback, link-local, ULA, or metadata range. */
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

  // If the host is a literal IP, check it directly. Otherwise resolve all
  // addresses and reject if ANY of them is blocked (avoids a partial-block
  // bypass where one A record is public and another is private).
  if (isIP(host) !== 0) {
    if (isBlockedAddress(host)) {
      throw new Error("Webhook host resolves to a blocked address range");
    }
    return;
  }

  let addresses: { address: string }[];
  try {
    addresses = await lookup(host, { all: true });
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
