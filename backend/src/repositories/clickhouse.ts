import { createClient } from "@clickhouse/client";
import { config } from "../config/index.js";
import { createChildLogger } from "../logger.js";

const log = createChildLogger("clickhouse");

export const clickhouse = createClient({
  url: config.clickhouseUrl,
  request_timeout: 30_000,
  max_open_connections: 10,
  keep_alive: { enabled: true },
});

export async function connectClickHouse(): Promise<void> {
  const result = await clickhouse.ping();
  if (!result.success) {
    throw new Error("ClickHouse ping failed");
  }
  log.info("ClickHouse connected");
}

export async function disconnectClickHouse(): Promise<void> {
  await clickhouse.close();
  log.info("ClickHouse disconnected");
}
