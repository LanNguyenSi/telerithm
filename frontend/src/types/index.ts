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

