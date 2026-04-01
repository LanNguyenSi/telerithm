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

export interface FacetBucket {
  value: string;
  count: number;
}

export interface LogFacet {
  field: string;
  buckets: FacetBucket[];
}

export interface LogHistogramBucket {
  start: string;
  end: string;
  count: number;
}

export interface LogPattern {
  key: string;
  signature: string;
  sampleMessage: string;
  count: number;
  latestTimestamp: string;
  service?: string;
  level?: string;
  host?: string;
}

export interface SavedLogViewDefinition {
  mode?: "raw" | "patterns";
  startTime?: string;
  endTime?: string;
  relativeTime?: string;
  text?: string;
  sourceId?: string;
  filters: Array<{
    field: string;
    operator: "eq" | "neq" | "gt" | "lt" | "contains";
    value: string | number;
  }>;
  columns: string[];
  sortBy: "timestamp" | "level" | "service" | "host";
  sortDirection: "asc" | "desc";
  facets: Array<{ field: string; value: string }>;
  exclusions: Array<{ field: string; value: string }>;
  pageSize: number;
}

export interface SavedLogView {
  id: string;
  teamId: string;
  ownerUserId?: string | null;
  name: string;
  isShared: boolean;
  isDefault: boolean;
  definition: SavedLogViewDefinition;
  createdAt: string;
  updatedAt: string;
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
  createdAt: string;
}

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: "USER" | "ADMIN";
  status: "ACTIVE" | "PENDING" | "DISABLED";
}

export interface AdminUser {
  id: string;
  email: string;
  name: string;
  role: "USER" | "ADMIN";
  status: "ACTIVE" | "PENDING" | "DISABLED";
  createdAt: string;
  teams: Array<{
    id: string;
    name: string;
    slug: string;
    role: "OWNER" | "ADMIN" | "MEMBER" | "VIEWER";
    joinedAt: string;
  }>;
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
