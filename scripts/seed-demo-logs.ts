#!/usr/bin/env tsx
/**
 * Demo Log Data Seeder for Telerithm
 * Generates realistic log data from various services for demo/testing purposes
 */

import { createClient } from "@clickhouse/client";

// Configuration
const CLICKHOUSE_URL = process.env.CLICKHOUSE_URL || "http://localhost:8123";
const TEAM_ID = process.env.TEAM_ID || "demo-team";
const SOURCE_ID = process.env.SOURCE_ID || "demo-source";
const DAYS = parseInt(process.env.DAYS || "7", 10);
const LOGS_PER_DAY = parseInt(process.env.LOGS_PER_DAY || "1000", 10);

const clickhouse = createClient({
  url: CLICKHOUSE_URL,
});

// Service definitions
const services = [
  { name: "triologue-api", weight: 30 },
  { name: "event-booking", weight: 25 },
  { name: "traefik", weight: 20 },
  { name: "health-dashboard", weight: 15 },
  { name: "gateway", weight: 10 },
];

// Log templates by service
const logTemplates: Record<
  string,
  Array<{ level: string; message: string; fields?: Record<string, string> }>
> = {
  "triologue-api": [
    {
      level: "info",
      message: "Message sent in room {roomId}",
      fields: { roomId: "memory-weaver-{id}" },
    },
    {
      level: "info",
      message: "WebSocket connected",
      fields: { agentId: "{agent}", ip: "192.168.{octet}.{octet}" },
    },
    {
      level: "info",
      message: "WebSocket disconnected",
      fields: { agentId: "{agent}", duration: "{time}s" },
    },
    {
      level: "info",
      message: "User authenticated",
      fields: { userId: "user-{id}", method: "token" },
    },
    {
      level: "info",
      message: "Room created",
      fields: { roomId: "room-{id}", projectId: "proj-{id}" },
    },
    {
      level: "warn",
      message: "Rate limit approaching for user {userId}",
      fields: { userId: "user-{id}", current: "90" },
    },
    {
      level: "error",
      message: "WebSocket error: {error}",
      fields: { error: "ECONNRESET", agentId: "{agent}" },
    },
    {
      level: "error",
      message: "Database query timeout",
      fields: { query: "SELECT * FROM messages", duration: "5000ms" },
    },
  ],
  "event-booking": [
    {
      level: "info",
      message: "Booking confirmed for event {eventId}",
      fields: { eventId: "evt-{id}", userId: "user-{id}" },
    },
    {
      level: "info",
      message: "Event created: {eventName}",
      fields: { eventName: "Summer Festival", capacity: "100" },
    },
    {
      level: "info",
      message: "Email sent: Booking confirmation",
      fields: { to: "user@example.com", eventId: "evt-{id}" },
    },
    {
      level: "info",
      message: "Slot decremented",
      fields: { eventId: "evt-{id}", remaining: "{slots}" },
    },
    {
      level: "warn",
      message: "Low capacity warning",
      fields: { eventId: "evt-{id}", remaining: "5" },
    },
    {
      level: "warn",
      message: "Payment processing slow",
      fields: { orderId: "ord-{id}", duration: "3500ms" },
    },
    {
      level: "error",
      message: "Payment failed: {reason}",
      fields: { reason: "Card declined", orderId: "ord-{id}" },
    },
    {
      level: "error",
      message: "Email delivery failed",
      fields: { to: "bounced@example.com", reason: "Mailbox full" },
    },
  ],
  traefik: [
    {
      level: "info",
      message: "HTTP request",
      fields: { method: "GET", path: "/api/v1/health", status: "200" },
    },
    {
      level: "info",
      message: "HTTP request",
      fields: { method: "POST", path: "/api/v1/messages", status: "201" },
    },
    {
      level: "info",
      message: "SSL certificate renewed",
      fields: { domain: "logs.opentriologue.ai", expires: "90d" },
    },
    {
      level: "info",
      message: "Route added",
      fields: { host: "logs.opentriologue.ai", service: "telerithm-frontend" },
    },
    {
      level: "warn",
      message: "Slow backend response",
      fields: { backend: "triologue-api", duration: "2500ms" },
    },
    {
      level: "error",
      message: "Backend unavailable",
      fields: { backend: "event-booking", status: "503" },
    },
    {
      level: "error",
      message: "SSL handshake failed",
      fields: { domain: "logs.opentriologue.ai", error: "Timeout" },
    },
  ],
  "health-dashboard": [
    {
      level: "info",
      message: "Health check passed",
      fields: { service: "triologue-api", responseTime: "{time}ms" },
    },
    {
      level: "info",
      message: "Metrics collected",
      fields: { service: "event-booking", cpu: "{cpu}%", memory: "{mem}MB" },
    },
    {
      level: "warn",
      message: "High memory usage",
      fields: { service: "traefik", memory: "1800MB", limit: "2048MB" },
    },
    {
      level: "warn",
      message: "Disk usage high",
      fields: { partition: "/var/lib/docker", usage: "85%" },
    },
    {
      level: "error",
      message: "Health check failed",
      fields: { service: "event-booking", error: "Connection refused" },
    },
  ],
  gateway: [
    {
      level: "info",
      message: "Agent connected",
      fields: { agentId: "{agent}", version: "1.0.0" },
    },
    {
      level: "info",
      message: "Agent disconnected",
      fields: { agentId: "{agent}", uptime: "{time}s" },
    },
    {
      level: "info",
      message: "SSE stream opened",
      fields: { agentId: "{agent}", sessionId: "sess-{id}" },
    },
    {
      level: "warn",
      message: "Agent heartbeat missed",
      fields: { agentId: "{agent}", lastSeen: "120s" },
    },
    {
      level: "error",
      message: "SSE connection dropped",
      fields: { agentId: "{agent}", reason: "timeout" },
    },
    {
      level: "error",
      message: "Agent authentication failed",
      fields: { agentId: "{agent}", reason: "Invalid token" },
    },
  ],
};

// Helpers
const randomInt = (min: number, max: number) =>
  Math.floor(Math.random() * (max - min + 1)) + min;
const randomChoice = <T>(arr: T[]): T =>
  arr[Math.floor(Math.random() * arr.length)];
const weightedRandom = () => {
  const totalWeight = services.reduce((sum, s) => sum + s.weight, 0);
  let random = Math.random() * totalWeight;
  for (const service of services) {
    random -= service.weight;
    if (random <= 0) return service.name;
  }
  return services[0].name;
};

const interpolate = (template: string): string => {
  return template
    .replace(/{id}/g, () => randomInt(1000, 9999).toString())
    .replace(/{agent}/g, () => randomChoice(["ice", "lava", "morty", "rick"]))
    .replace(/{octet}/g, () => randomInt(1, 254).toString())
    .replace(/{time}/g, () => randomInt(100, 5000).toString())
    .replace(/{slots}/g, () => randomInt(5, 50).toString())
    .replace(/{cpu}/g, () => randomInt(10, 80).toString())
    .replace(/{mem}/g, () => randomInt(200, 1500).toString())
    .replace(/{roomId}/g, () => `room-${randomInt(1000, 9999)}`)
    .replace(/{eventId}/g, () => `evt-${randomInt(1000, 9999)}`)
    .replace(/{userId}/g, () => `user-${randomInt(100, 999)}`)
    .replace(/{eventName}/g, () =>
      randomChoice([
        "Summer Festival",
        "Tech Conference",
        "Workshop",
        "Meetup",
      ]),
    )
    .replace(/{error}/g, () =>
      randomChoice([
        "ECONNRESET",
        "ETIMEDOUT",
        "ECONNREFUSED",
        "ERR_SSL_PROTOCOL_ERROR",
      ]),
    )
    .replace(/{reason}/g, () =>
      randomChoice([
        "Card declined",
        "Insufficient funds",
        "Invalid CVV",
        "Expired card",
      ]),
    );
};

// Generate timestamp with business hours bias
const generateTimestamp = (daysAgo: number): Date => {
  const now = new Date();
  const baseTime = new Date(now.getTime() - daysAgo * 24 * 60 * 60 * 1000);

  // Business hours (9-18 UTC) have higher probability
  const hour = randomInt(0, 23);
  const isBusinessHours = hour >= 9 && hour <= 18;
  const shouldGenerate = isBusinessHours
    ? Math.random() < 0.7
    : Math.random() < 0.3;

  if (!shouldGenerate && Math.random() > 0.1) {
    // Skip this log (create time gaps)
    return generateTimestamp(daysAgo);
  }

  baseTime.setHours(
    hour,
    randomInt(0, 59),
    randomInt(0, 59),
    randomInt(0, 999),
  );
  return baseTime;
};

// Generate log entry
const generateLog = (service: string, timestamp: Date) => {
  const templates = logTemplates[service];
  const template = randomChoice(templates);

  // Level distribution: 80% info, 15% warn, 5% error
  let level = template.level;
  const rand = Math.random();
  if (level === "info" && rand < 0.15) level = "warn";
  if (level === "info" && rand < 0.05) level = "error";

  const message = interpolate(template.message);
  const fields: Record<string, string> = {};

  if (template.fields) {
    for (const [key, value] of Object.entries(template.fields)) {
      fields[key] = interpolate(value);
    }
  }

  return {
    team_id: TEAM_ID,
    source_id: SOURCE_ID,
    timestamp: timestamp.toISOString().replace("T", " ").replace("Z", ""),
    level,
    service,
    host: `${service}-${randomInt(1, 3)}`,
    message,
    fields,
  };
};

// Create error cluster (simulated incident)
const createIncident = (baseTime: Date, service: string) => {
  const logs: any[] = [];
  const errorCount = randomInt(10, 30);

  for (let i = 0; i < errorCount; i++) {
    const timestamp = new Date(baseTime.getTime() + i * randomInt(1000, 10000));
    const template =
      logTemplates[service].find((t) => t.level === "error") ||
      logTemplates[service][0];
    const message = interpolate(template.message);

    logs.push({
      team_id: TEAM_ID,
      source_id: SOURCE_ID,
      timestamp: timestamp.toISOString().replace("T", " ").replace("Z", ""),
      level: "error",
      service,
      host: `${service}-1`,
      message,
      fields: template.fields
        ? Object.fromEntries(
            Object.entries(template.fields).map(([k, v]) => [
              k,
              interpolate(v),
            ]),
          )
        : {},
    });
  }

  return logs;
};

// Main seeder
async function seedLogs() {
  console.log("🌱 Seeding demo logs...");
  console.log(`  Team ID: ${TEAM_ID}`);
  console.log(`  Source ID: ${SOURCE_ID}`);
  console.log(`  Days: ${DAYS}`);
  console.log(`  Logs per day: ${LOGS_PER_DAY}`);
  console.log("");

  const allLogs: any[] = [];

  // Generate regular logs
  for (let day = 0; day < DAYS; day++) {
    console.log(`  Generating day ${day + 1}/${DAYS}...`);

    for (let i = 0; i < LOGS_PER_DAY; i++) {
      const service = weightedRandom();
      const timestamp = generateTimestamp(DAYS - day - 1);
      const log = generateLog(service, timestamp);
      allLogs.push(log);
    }
  }

  // Add 3 incidents (error clusters)
  console.log("  Adding incidents...");
  const incidentDay1 = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
  incidentDay1.setHours(14, 30, 0, 0);
  allLogs.push(...createIncident(incidentDay1, "triologue-api"));

  const incidentDay2 = new Date(Date.now() - 4 * 24 * 60 * 60 * 1000);
  incidentDay2.setHours(10, 15, 0, 0);
  allLogs.push(...createIncident(incidentDay2, "event-booking"));

  const incidentDay3 = new Date(Date.now() - 6 * 24 * 60 * 60 * 1000);
  incidentDay3.setHours(16, 45, 0, 0);
  allLogs.push(...createIncident(incidentDay3, "traefik"));

  // Sort by timestamp
  allLogs.sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
  );

  console.log(`  Total logs: ${allLogs.length}`);
  console.log("");
  console.log("📤 Inserting into ClickHouse...");

  // Batch insert (1000 rows at a time)
  const batchSize = 1000;
  for (let i = 0; i < allLogs.length; i += batchSize) {
    const batch = allLogs.slice(i, i + batchSize);
    await clickhouse.insert({
      table: "logs",
      values: batch,
      format: "JSONEachRow",
    });
    console.log(
      `  Inserted ${Math.min(i + batchSize, allLogs.length)}/${allLogs.length}`,
    );
  }

  console.log("");
  console.log("✅ Seeding complete!");
  console.log("");
  console.log("📊 Summary:");
  console.log(`  Total logs: ${allLogs.length}`);
  console.log(`  Services: ${services.map((s) => s.name).join(", ")}`);
  console.log(
    `  Levels: ${allLogs.filter((l) => l.level === "info").length} info, ${allLogs.filter((l) => l.level === "warn").length} warn, ${allLogs.filter((l) => l.level === "error").length} error`,
  );
  console.log(
    `  Time range: ${allLogs[0].timestamp} to ${allLogs[allLogs.length - 1].timestamp}`,
  );
  console.log("");
  console.log("🔍 Try these queries:");
  console.log('  "show me errors from the last 24 hours"');
  console.log('  "traefik errors"');
  console.log('  "booking confirmations"');
}

// Run
seedLogs()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("❌ Seeding failed:", error);
    process.exit(1);
  });
