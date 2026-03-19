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
