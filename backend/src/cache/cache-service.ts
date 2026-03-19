import { redis } from "../repositories/redis.js";
import { createChildLogger } from "../logger.js";

const log = createChildLogger("cache");

export class CacheService {
  async get<T>(key: string): Promise<T | null> {
    const raw = await redis.get(key);
    if (!raw) return null;

    try {
      log.debug({ key }, "Cache hit");
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }

  async set(key: string, value: unknown, ttlSeconds: number): Promise<void> {
    await redis.set(key, JSON.stringify(value), "EX", ttlSeconds);
    log.debug({ key, ttlSeconds }, "Cache set");
  }

  async invalidate(pattern: string): Promise<void> {
    const keys = await redis.keys(pattern);
    if (keys.length > 0) {
      await redis.del(...keys);
      log.debug({ pattern, count: keys.length }, "Cache invalidated");
    }
  }
}

export const cache = new CacheService();
