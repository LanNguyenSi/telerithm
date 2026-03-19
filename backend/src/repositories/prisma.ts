import { PrismaClient } from "@prisma/client";
import { config } from "../config/index.js";
import { createChildLogger } from "../logger.js";

const log = createChildLogger("prisma");

export const prisma = new PrismaClient({
  datasourceUrl: config.databaseUrl,
  log:
    config.nodeEnv === "development"
      ? [
          { emit: "event", level: "query" },
          { emit: "event", level: "error" },
        ]
      : [{ emit: "event", level: "error" }],
});

prisma.$on("error" as never, (e: unknown) => {
  log.error(e, "Prisma error");
});

export async function connectDatabase(): Promise<void> {
  await prisma.$connect();
  log.info("PostgreSQL connected");
}

export async function disconnectDatabase(): Promise<void> {
  await prisma.$disconnect();
  log.info("PostgreSQL disconnected");
}
