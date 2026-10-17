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

export interface NaturalQueryPlan {
  explanation: string;
  inferredTimeRange?: { startTime: string; endTime: string };
  filtersApplied: Array<{
    field: string;
    operator: "eq" | "neq" | "gt" | "lt" | "contains";
    value: string | number;
  }>;
  textTerms?: string[];
  warnings?: string[];
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

// What PUT /logs/views/:id answers when OWNER/ADMIN clears the default flag
// of another user's private view: identity and flags only.
export type SavedLogViewStub = Omit<SavedLogView, "name" | "definition">;

export function isSavedLogViewStub(view: SavedLogView | SavedLogViewStub): view is SavedLogViewStub {
  return !("definition" in view);
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

export type TeamRole = "OWNER" | "ADMIN" | "MEMBER" | "VIEWER";

/** A team as listed for the signed-in user: carries that user's own membership role. */
export interface TeamWithRole extends Team {
  role: TeamRole;
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
  // Absent for VIEWER and MEMBER: the API omits the ingest key from reads unless
  // the caller is OWNER or ADMIN. The create response still carries it.
  apiKey?: string;
}

/** Conditions the API accepts for new and edited rules. */
export const ALERT_CONDITIONS = ["GREATER_THAN", "LESS_THAN", "EQUALS", "CHANGES_BY"] as const;
export type EditableAlertCondition = (typeof ALERT_CONDITIONS)[number];

export interface AlertRule {
  id: string;
  name: string;
  description?: string;
  query: string;
  /** ANOMALY_DETECTED can exist on older rows; the API rejects it on write. */
  condition: EditableAlertCondition | "ANOMALY_DETECTED";
  threshold: number;
  windowMinutes: number;
  enabled: boolean;
}

export interface AlertRuleInput {
  name: string;
  description?: string;
  query: string;
  condition: EditableAlertCondition;
  threshold: number;
  windowMinutes: number;
  enabled: boolean;
}

export const SOURCE_TYPES = ["HTTP", "SYSLOG_UDP", "SYSLOG_TCP", "FILEBEAT", "DOCKER", "CLOUDWATCH"] as const;
export type SourceType = (typeof SOURCE_TYPES)[number];

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
