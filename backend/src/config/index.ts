import { z } from "zod";

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
