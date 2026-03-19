import IORedis from "ioredis";
const Redis = IORedis.default ?? IORedis;
import { config } from "../config/index.js";
import { createChildLogger } from "../logger.js";

const log = createChildLogger("redis");

export const redis = new Redis(config.redisUrl, {
  maxRetriesPerRequest: 3,
  lazyConnect: true,
});

redis.on("error", (err: Error) => {
  log.error({ err: err.message }, "Redis error");
});

export async function connectRedis(): Promise<void> {
  await redis.connect();
  log.info("Redis connected");
}

export async function disconnectRedis(): Promise<void> {
  await redis.quit();
  log.info("Redis disconnected");
}
