import { EventEmitter } from "node:events";
import type {
  AlertIncident,
  AlertRule,
  LogEntry,
  LogSource,
  Session,
  Team,
  TeamMember,
  User,
} from "../types/domain.js";
import { generateId, hashValue } from "../utils/id.js";
import { hoursAgoIso, nowIso } from "../utils/time.js";

export class InMemoryStore {
  readonly events = new EventEmitter();

  users: User[] = [];
  sessions: Session[] = [];
  teams: Team[] = [];
  teamMembers: TeamMember[] = [];
  sources: LogSource[] = [];
  logs: LogEntry[] = [];
  alertRules: AlertRule[] = [];
  incidents: AlertIncident[] = [];

  constructor() {
    this.seed();
  }

  private seed(): void {
    const userId = generateId();
    const teamId = generateId();
    const sourceId = generateId();
    const createdAt = nowIso();
    const apiKey = `lf_${hashValue(sourceId).slice(0, 24)}`;

    this.users.push({
      id: userId,
      email: "demo@telerithm.dev",
      passwordHash: hashValue("demo123"),
      name: "Demo User",
      role: "ADMIN",
      status: "ACTIVE",
      createdAt,
    });

    this.teams.push({
      id: teamId,
      name: "Demo Team",
      slug: "demo-team",
      createdAt,
    });

    this.teamMembers.push({
      id: generateId(),
      teamId,
      userId,
      role: "OWNER",
      joinedAt: createdAt,
    });

    this.sources.push({
      id: sourceId,
      teamId,
      name: "demo-api",
      type: "HTTP",
      config: { endpoint: "/api/v1/ingest/:sourceId" },
      retentionDays: 7,
      createdAt,
      apiKey,
    });

    this.alertRules.push({
      id: generateId(),
      teamId,
      name: "Spike in payment errors",
      description: "Triggers when payment errors exceed threshold",
      query: "SELECT count() FROM logs WHERE level = 'error' AND service = 'payment'",
      queryType: "sql",
      threshold: 10,
      enabled: true,
      createdAt,
    });

    this.incidents.push({
      id: generateId(),
      ruleId: this.alertRules[0].id,
      status: "OPEN",
      severity: "HIGH",
      message: "Payment error rate is elevated",
      createdAt,
    });

    const seedLogs: LogEntry[] = [
      {
        id: generateId(),
        teamId,
        sourceId,
        timestamp: nowIso(),
        level: "error",
        service: "payment",
        host: "api-1",
        message: "Payment authorization failed for order 4721",
        fields: { status_code: 502, amount: 189.5, region: "eu-central" },
      },
      {
        id: generateId(),
        teamId,
        sourceId,
        timestamp: nowIso(),
        level: "warn",
        service: "checkout",
        host: "web-2",
        message: "Checkout latency above threshold",
        fields: { duration_ms: 842, route: "/checkout" },
      },
      {
        id: generateId(),
        teamId,
        sourceId,
        timestamp: hoursAgoIso(1),
        level: "info",
        service: "auth",
        host: "auth-1",
        message: "User session refreshed",
        fields: { user_id: "u_123", region: "us-east" },
      },
      {
        id: generateId(),
        teamId,
        sourceId,
        timestamp: hoursAgoIso(3),
        level: "error",
        service: "database",
        host: "db-1",
        message: "Slow query exceeded 1200ms",
        fields: { duration_ms: 1200, query_name: "orders_report" },
      },
    ];

    this.logs.push(...seedLogs);
  }
}

export const store = new InMemoryStore();
