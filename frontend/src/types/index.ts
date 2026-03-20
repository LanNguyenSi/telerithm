export type LogLevel = "debug" | "info" | "warn" | "error" | "fatal";

export interface LogEntry {
  id: string;
  teamId: string;
  sourceId: string;
  timestamp: string;
  level: LogLevel;
  service: string;
  host: string;
  message: string;
  fields: Record<string, string | number | boolean>;
}

export interface DashboardOverview {
  teamId: string;
  totalLogs: number;
  errorRate: number;
  services: Array<{ service: string; count: number }>;
  recentIncidents: Array<{
    id: string;
    message: string;
    severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
    status: "OPEN" | "ACKNOWLEDGED" | "RESOLVED";
    createdAt: string;
  }>;
}

export interface Team {
  id: string;
  name: string;
  slug: string;
  plan: string;
  createdAt: string;
}

export interface Source {
  id: string;
  teamId: string;
  name: string;
  type: string;
  retentionDays: number;
  apiKey: string;
}

export interface AlertRule {
  id: string;
  name: string;
  description?: string;
  threshold: number;
  enabled: boolean;
}

export interface AlertIncident {
  id: string;
  message: string;
  severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
  status: "OPEN" | "ACKNOWLEDGED" | "RESOLVED";
  createdAt: string;
}

export interface AlertSubscription {
  id: string;
  userId: string;
  teamId: string;
  ruleId: string | null;
  channel: "EMAIL" | "WEBHOOK" | "SLACK" | "MSTEAMS";
  config: Record<string, unknown>;
  severities: string[];
  enabled: boolean;
  createdAt: string;
  rule?: { id: string; name: string } | null;
}

export interface Issue {
  id: string;
  teamId: string;
  fingerprint: string;
  title: string;
  level: string;
  service: string;
  status: "NEW" | "ONGOING" | "RESOLVED" | "IGNORED";
  firstSeen: string;
  lastSeen: string;
  eventCount: number;
  assignee?: { id: string; name: string; email: string } | null;
}

