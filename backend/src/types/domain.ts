export type QueryType = "sql" | "natural";
export type LogFormat = "json" | "syslog_rfc3164" | "syslog_rfc5424" | "plain";
export type LogLevel = "debug" | "info" | "warn" | "error" | "fatal";
export type SourceType =
  | "HTTP"
  | "SYSLOG_UDP"
  | "SYSLOG_TCP"
  | "FILEBEAT"
  | "DOCKER"
  | "CLOUDWATCH";
export type TeamPlan = "FREE" | "STARTER" | "PRO" | "ENTERPRISE";

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

export interface LogFilter {
  field: string;
  operator: "eq" | "neq" | "gt" | "lt" | "contains";
  value: string | number;
}

export interface LogQuery {
  teamId: string;
  sourceId?: string;
  startTime?: string;
  endTime?: string;
  query?: string;
  queryType: QueryType;
  filters?: LogFilter[];
  limit?: number;
  offset?: number;
}

export interface LogSearchResult {
  logs: LogEntry[];
  total: number;
  query: string;
  executionTimeMs: number;
  cached: boolean;
}

export interface User {
  id: string;
  email: string;
  passwordHash: string;
  name: string;
  role: "USER" | "ADMIN";
  createdAt: string;
}

export interface Session {
  id: string;
  userId: string;
  token: string;
  expiresAt: string;
}

export interface TeamMember {
  id: string;
  teamId: string;
  userId: string;
  role: "OWNER" | "ADMIN" | "MEMBER" | "VIEWER";
  joinedAt: string;
}

export interface Team {
  id: string;
  name: string;
  slug: string;
  plan: TeamPlan;
  createdAt: string;
}

export interface LogSource {
  id: string;
  teamId: string;
  name: string;
  type: SourceType;
  config: Record<string, unknown>;
  retentionDays: number;
  createdAt: string;
  apiKey: string;
}

export interface AlertRule {
  id: string;
  teamId: string;
  name: string;
  description?: string;
  query: string;
  queryType: QueryType;
  threshold: number;
  enabled: boolean;
  createdAt: string;
}

export interface AlertIncident {
  id: string;
  ruleId: string;
  status: "OPEN" | "ACKNOWLEDGED" | "RESOLVED";
  severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
  message: string;
  createdAt: string;
}

export interface DashboardSummary {
  teamId: string;
  totalLogs: number;
  errorRate: number;
  services: Array<{ service: string; count: number }>;
  recentIncidents: AlertIncident[];
}

export interface AuthResult {
  token: string;
  user: Omit<User, "passwordHash">;
}

export interface IngestRequestPayload {
  logs: Array<Partial<LogEntry> | string>;
  format?: LogFormat;
  batchId?: string;
}

export interface IngestResponse {
  accepted: number;
  rejected: number;
  errors: Array<{ index: number; error: string }>;
  batchId: string;
}

export interface NLQTranslation {
  sql: string;
  explanation: string;
  filtersApplied: LogFilter[];
}

