import { createApp } from "./app.js";
import { config } from "./config/index.js";
import { logger } from "./logger.js";
import { connectDatabase, disconnectDatabase } from "./repositories/prisma.js";
import { connectClickHouse, disconnectClickHouse } from "./repositories/clickhouse.js";
import { connectRedis, disconnectRedis } from "./repositories/redis.js";

async function connectWithRetry(
  name: string,
  connectFn: () => Promise<void>,
  maxRetries = 10,
  delayMs = 3000,
): Promise<void> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await connectFn();
      return;
    } catch (err) {
      if (attempt === maxRetries) throw err;
      logger.warn({ attempt, maxRetries, service: name }, `${name} not ready, retrying...`);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}

async function main() {
  await Promise.all([
    connectWithRetry("PostgreSQL", connectDatabase),
    connectWithRetry("ClickHouse", connectClickHouse),
    connectWithRetry("Redis", connectRedis),
  ]);

  const app = createApp();

  const server = app.listen(config.port, config.host, () => {
    logger.info({ port: config.port, host: config.host, env: config.nodeEnv }, "Server started");
  });

  server.keepAliveTimeout = 65_000;
  server.headersTimeout = 66_000;

  async function shutdown(signal: string) {
    logger.info({ signal }, "Shutting down gracefully");
    server.close(async () => {
      await Promise.all([disconnectDatabase(), disconnectClickHouse(), disconnectRedis()]);
      logger.info("Shutdown complete");
      process.exit(0);
    });

    setTimeout(() => {
      logger.error("Forced shutdown after timeout");
      process.exit(1);
    }, 10_000);
  }

  const selfMonitor = setInterval(() => {
    const mem = process.memoryUsage();
    logger.info(
      {
        heapUsedMb: Math.round(mem.heapUsed / 1024 / 1024),
        heapTotalMb: Math.round(mem.heapTotal / 1024 / 1024),
        rssMb: Math.round(mem.rss / 1024 / 1024),
        uptimeS: Math.round(process.uptime()),
      },
      "Process health",
    );
  }, 60_000);

  process.on("SIGTERM", () => {
    clearInterval(selfMonitor);
    shutdown("SIGTERM");
  });
  process.on("SIGINT", () => {
    clearInterval(selfMonitor);
    shutdown("SIGINT");
  });
}

main().catch((err) => {
  logger.fatal(err, "Failed to start server");
  process.exit(1);
});
