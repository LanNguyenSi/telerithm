import { isIP } from "node:net";
import { z } from "zod";

// Value handed to Express's `trust proxy` setting: a hop count, the
// `loopback` keyword, or a list of trusted proxy IPs/CIDRs. `undefined` means
// "do not trust any proxy" (Express's default), so `req.ip` is the socket peer.
export type TrustProxySetting = number | "loopback" | string[];

const TRUST_PROXY_EXPECTED =
  "unset (no proxy trusted), a non-negative integer hop count (e.g. 1 for a single reverse proxy), " +
  '"loopback", or a comma-separated list of proxy IPs/CIDRs';

function isIpOrCidr(entry: string): boolean {
  const slash = entry.indexOf("/");
  if (slash === -1) return isIP(entry) !== 0;
  const version = isIP(entry.slice(0, slash));
  const prefix = entry.slice(slash + 1);
  if (version === 0 || !/^\d{1,3}$/.test(prefix)) return false;
  return Number(prefix) <= (version === 4 ? 32 : 128);
}

// Parses the TRUST_PROXY env var. The boolean `true` is rejected on purpose:
// Express's `trust proxy: true` trusts every X-Forwarded-For entry, so any
// client could pick its own rate-limit key by sending the header.
export function parseTrustProxy(raw: string | undefined): TrustProxySetting | undefined {
  const value = (raw ?? "").trim();
  if (value === "") return undefined;
  if (value.toLowerCase() === "true") {
    throw new Error(
      "TRUST_PROXY=true is not allowed: it trusts every X-Forwarded-For entry, so clients could spoof " +
        `their IP and dodge the rate limiters. Expected ${TRUST_PROXY_EXPECTED}`,
    );
  }
  if (/^\d+$/.test(value)) return Number(value);
  if (value === "loopback") return "loopback";
  const entries = value.split(",").map((e) => e.trim());
  if (entries.every((e) => e !== "" && isIpOrCidr(e))) return entries;
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
