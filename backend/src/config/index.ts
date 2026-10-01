import { isIP } from "node:net";
import express from "express";
import { z } from "zod";

// Value handed to Express's `trust proxy` setting: a hop count, the
// `loopback` keyword, or a list of trusted proxy IPs/CIDRs. `undefined` means
// "do not trust any proxy" (Express's default), so `req.ip` is the socket peer.
export type TrustProxySetting = number | "loopback" | string[];

// Express trusts every hop (so any client can pick its own rate-limit key) when
// the hop count is unbounded or an entry covers the whole address space. These
// bounds keep a typo or a lazy "trust everything" value from getting there.
// No real deployment has more reverse proxies in front of the app than this,
// and a count above the real number of hops already lets a client choose its key.
export const TRUST_PROXY_MAX_HOPS = 10;
// Shortest accepted prefixes: /8 for IPv4 (one legacy class A block) and /32
// for IPv6 (the smallest block a provider is normally allocated). Anything
// shorter is a range of the internet, not a proxy.
export const TRUST_PROXY_MIN_IPV4_PREFIX = 8;
export const TRUST_PROXY_MIN_IPV6_PREFIX = 32;

const TRUST_PROXY_EXPECTED =
  "unset (no proxy trusted), a non-negative integer hop count of at most " +
  `${TRUST_PROXY_MAX_HOPS} (e.g. 1 for a single reverse proxy), "loopback", or a comma-separated list of ` +
  `proxy IPs/CIDRs (IPv4 prefix /${TRUST_PROXY_MIN_IPV4_PREFIX} or longer, IPv6 prefix /${TRUST_PROXY_MIN_IPV6_PREFIX} or longer)`;

// First 96 bits of an IPv4-mapped IPv6 address (::ffff:0:0/96) as a BigInt
// of the whole 128-bit value.
const IPV4_MAPPED_BASE = 0xffffn << 32n;

// Converts a valid IPv6 literal to its 128-bit value.
function ipv6ToBigInt(address: string): bigint {
  let text = address.split("%")[0] ?? address;
  const dotted = /^(.*:)(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(text);
  if (dotted) {
    const [, head, a, b, c, d] = dotted;
    const hi = ((Number(a) << 8) | Number(b)).toString(16);
    const lo = ((Number(c) << 8) | Number(d)).toString(16);
    text = `${head}${hi}:${lo}`;
  }
  const halves = text.split("::");
  const toGroups = (part: string | undefined) => (part ? part.split(":") : []);
  const head = toGroups(halves[0]);
  const tail = toGroups(halves[1]);
  const fill = halves.length === 2 ? 8 - head.length - tail.length : 0;
  const groups = [...head, ...Array<string>(fill).fill("0"), ...tail];
  return groups.reduce((acc, g) => (acc << 16n) | BigInt(parseInt(g, 16)), 0n);
}

// Returns why a syntactically valid IP/CIDR entry is too broad to trust, or
// undefined when it is acceptable. A bare address is always fine.
function tooBroad(entry: string): string | undefined {
  const slash = entry.indexOf("/");
  if (slash === -1) return undefined;
  const address = entry.slice(0, slash);
  const prefix = Number(entry.slice(slash + 1));
  if (isIP(address) === 4) {
    return prefix < TRUST_PROXY_MIN_IPV4_PREFIX
      ? `IPv4 prefix /${prefix} is shorter than /${TRUST_PROXY_MIN_IPV4_PREFIX}`
      : undefined;
  }
  if (prefix < TRUST_PROXY_MIN_IPV6_PREFIX) {
    return `IPv6 prefix /${prefix} is shorter than /${TRUST_PROXY_MIN_IPV6_PREFIX}`;
  }
  // Express matches an IPv4 peer against an IPv6 range as its IPv4-mapped
  // form, so an IPv6 range that contains ::ffff:0:0/96 (for example ::/32 or
  // ::ffff:0:0/96 itself) trusts every IPv4 peer, and a mapped range longer
  // than /96 is an IPv4 range of prefix (length - 96).
  const value = ipv6ToBigInt(address);
  const shift = BigInt(128 - prefix);
  if (prefix <= 96 && value >> shift === IPV4_MAPPED_BASE >> shift) {
    return `the IPv6 range /${prefix} contains the IPv4-mapped block ::ffff:0:0/96, i.e. every IPv4 address`;
  }
  if (value >> 32n === IPV4_MAPPED_BASE >> 32n && prefix - 96 < TRUST_PROXY_MIN_IPV4_PREFIX) {
    return `the IPv4-mapped prefix /${prefix} is the IPv4 prefix /${prefix - 96}, shorter than /${TRUST_PROXY_MIN_IPV4_PREFIX}`;
  }
  return undefined;
}

// node:net's isIP accepts some IPv6 spellings (an embedded dotted IPv4 tail
// outside ::ffff:, a zone id) that Express's proxy-addr cannot parse; those
// would otherwise pass this check and only fail later inside app.set. Ask
// Express itself, so every accepted list is one it can use.
function expressRejects(entries: string[]): string | undefined {
  try {
    express().set("trust proxy", entries);
    return undefined;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

function isIpOrCidr(entry: string): boolean {
  const slash = entry.indexOf("/");
  if (slash === -1) return isIP(entry) !== 0;
  const version = isIP(entry.slice(0, slash));
  const prefix = entry.slice(slash + 1);
  if (version === 0 || !/^\d{1,3}$/.test(prefix)) return false;
  return Number(prefix) <= (version === 4 ? 32 : 128);
}

// Parses the TRUST_PROXY env var. Every value that makes Express trust all
// hops is rejected, not only the literal `true`: such a setting lets any
// client pick its own rate-limit key by sending X-Forwarded-For.
export function parseTrustProxy(raw: string | undefined): TrustProxySetting | undefined {
  const value = (raw ?? "").trim();
  if (value === "") return undefined;
  if (value.toLowerCase() === "true") {
    throw new Error(
      "TRUST_PROXY=true is not allowed: it trusts every X-Forwarded-For entry, so clients could spoof " +
        `their IP and dodge the rate limiters. Expected ${TRUST_PROXY_EXPECTED}`,
    );
  }
  if (/^\d+$/.test(value)) {
    const hops = Number(value);
    if (!Number.isSafeInteger(hops) || hops > TRUST_PROXY_MAX_HOPS) {
      throw new Error(
        `TRUST_PROXY=${JSON.stringify(value)} is not allowed: a hop count above ${TRUST_PROXY_MAX_HOPS} ` +
          `trusts more proxies than any deployment has, so clients could spoof their IP and dodge the rate limiters. Expected ${TRUST_PROXY_EXPECTED}`,
      );
    }
    return hops;
  }
  if (value === "loopback") return "loopback";
  const entries = value.split(",").map((e) => e.trim());
  if (entries.every((e) => e !== "" && isIpOrCidr(e))) {
    for (const entry of entries) {
      const reason = tooBroad(entry);
      if (reason) {
        throw new Error(
          `TRUST_PROXY entry ${JSON.stringify(entry)} is not allowed: ${reason}, which trusts far more than a proxy ` +
            `and lets clients spoof their IP and dodge the rate limiters. Expected ${TRUST_PROXY_EXPECTED}`,
        );
      }
    }
    const unusable = expressRejects(entries);
    if (unusable) {
      throw new Error(
        `TRUST_PROXY=${JSON.stringify(value)} is invalid: Express cannot use it (${unusable}). Expected ${TRUST_PROXY_EXPECTED}`,
      );
    }
    return entries;
  }
  throw new Error(`TRUST_PROXY=${JSON.stringify(value)} is invalid. Expected ${TRUST_PROXY_EXPECTED}`);
}

const configSchema = z.object({
  port: z.coerce.number().int().default(4000),
  host: z.string().default("127.0.0.1"),
  nodeEnv: z.enum(["development", "production", "test"]).default("development"),
  databaseUrl: z.string().url(),
  clickhouseUrl: z.string().url(),
  logLevel: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
  corsOrigins: z.string().default("http://localhost:3000"),
  redisUrl: z.string().url().default("redis://localhost:6379"),
  multiTenant: z
    .enum(["true", "false", "1", "0"])
    .default("false")
    .transform((v) => v === "true" || v === "1"),
  registrationMode: z.enum(["open", "invite-only", "approval"]).default("approval"),
  adminEmail: z
    .string()
    .email()
    .optional()
    .or(z.literal(""))
    .transform((v) => (v === "" ? undefined : v)),
  openaiApiKey: z.string().optional(), // Optional: AI query engine falls back to heuristic if not provided
  openaiBaseUrl: z.string().url().optional(), // Optional: OpenAI-compatible endpoint (e.g. Ollama, llama.cpp)
  openaiModel: z.string().optional(), // Optional: model name (default llama-3.3-70b-versatile)
  openaiTimeoutMs: z.coerce.number().int().positive().default(10000), // LLM call timeout
  maxLookbackMs: z.coerce
    .number()
    .int()
    .positive()
    .default(7 * 24 * 60 * 60 * 1000),
  maxPageSize: z.coerce.number().int().min(50).max(2000).default(500),
  maxSyncRuntimeMs: z.coerce.number().int().min(100).max(30_000).default(1500),
  // Strict per-user limit on routes that trigger a real notification dispatch
  // (currently POST /subscriptions/:id/test). Default: 5 requests / 5 minutes.
  notificationTestRateLimitWindowMs: z.coerce
    .number()
    .int()
    .positive()
    .default(5 * 60_000),
  notificationTestRateLimitMax: z.coerce.number().int().positive().default(5),
  // Opt-in proxy trust for the IP-keyed rate limiters; see parseTrustProxy.
  trustProxy: z
    .string()
    .optional()
    .transform((v, ctx) => {
      try {
        return parseTrustProxy(v);
      } catch (err) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: (err as Error).message });
        return z.NEVER;
      }
    }),
});

export type Config = z.infer<typeof configSchema>;

function loadConfig(): Config {
  const result = configSchema.safeParse({
    port: process.env.PORT,
    host: process.env.HOST,
    nodeEnv: process.env.NODE_ENV,
    databaseUrl: process.env.DATABASE_URL,
    clickhouseUrl: process.env.CLICKHOUSE_URL,
    logLevel: process.env.LOG_LEVEL,
    corsOrigins: process.env.CORS_ORIGINS,
    redisUrl: process.env.REDIS_URL,
    multiTenant: process.env.MULTI_TENANT,
    registrationMode: process.env.REGISTRATION_MODE,
    adminEmail: process.env.ADMIN_EMAIL,
    openaiApiKey: process.env.OPENAI_API_KEY,
    openaiBaseUrl: process.env.OPENAI_BASE_URL,
    openaiModel: process.env.OPENAI_MODEL,
    openaiTimeoutMs: process.env.OPENAI_TIMEOUT_MS,
    maxLookbackMs: process.env.MAX_LOOKBACK_MS,
    maxPageSize: process.env.MAX_PAGE_SIZE,
    maxSyncRuntimeMs: process.env.MAX_SYNC_RUNTIME_MS,
    notificationTestRateLimitWindowMs: process.env.NOTIFICATION_TEST_RATE_LIMIT_WINDOW_MS,
    notificationTestRateLimitMax: process.env.NOTIFICATION_TEST_RATE_LIMIT_MAX,
    trustProxy: process.env.TRUST_PROXY,
  });

  if (!result.success) {
    const formatted = result.error.flatten().fieldErrors;
    const missing = Object.entries(formatted)
      .map(([key, errors]) => `  ${key}: ${errors?.join(", ")}`)
      .join("\n");
    throw new Error(`Invalid configuration:\n${missing}`);
  }

  return result.data;
}

export const config = loadConfig();
