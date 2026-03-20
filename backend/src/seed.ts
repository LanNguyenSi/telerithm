import { PrismaClient } from "@prisma/client";
import { hashSync } from "bcrypt";
import { randomUUID } from "node:crypto";

const prisma = new PrismaClient();

async function main() {
  const existingUser = await prisma.user.findUnique({ where: { email: "demo@logforge.dev" } });
  if (existingUser) {
    console.log("Seed data already exists, skipping.");
    return;
  }

  const user = await prisma.user.create({
    data: {
      email: "demo@logforge.dev",
      passwordHash: hashSync("demo123", 12),
      name: "Demo User",
      role: "ADMIN",
    },
  });

  const team = await prisma.team.create({
    data: {
      name: "Demo Team",
      slug: "demo-team",
      members: {
        create: { userId: user.id, role: "OWNER" },
      },
    },
  });

  const apiKey = `lf_${randomUUID().replace(/-/g, "").slice(0, 24)}`;
  const source = await prisma.logSource.create({
    data: {
      teamId: team.id,
      name: "demo-api",
      type: "HTTP",
      config: { endpoint: "/api/v1/ingest/:sourceId" },
      retentionDays: 7,
      apiKey,
    },
  });

  const rule = await prisma.alertRule.create({
    data: {
      teamId: team.id,
      name: "Spike in payment errors",
      description: "Triggers when payment errors exceed threshold",
      query: "SELECT count() FROM logs WHERE level = 'error' AND service = 'payment'",
      queryType: "SQL",
      condition: "GREATER_THAN",
      threshold: 10,
      enabled: true,
    },
  });

  await prisma.alertIncident.create({
    data: {
      ruleId: rule.id,
      status: "OPEN",
      severity: "HIGH",
      message: "Payment error rate is elevated",
    },
  });

  console.log("Seed data created:");
  console.log(`  User: ${user.email}`);
  console.log(`  Team: ${team.slug}`);
  console.log(`  Source: ${source.name} (${source.id})`);
  console.log(`  API Key: ${apiKey}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
