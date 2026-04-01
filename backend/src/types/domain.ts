export type QueryType = "sql" | "natural";
export type LogFormat = "json" | "syslog_rfc3164" | "syslog_rfc5424" | "plain";
export type LogLevel = "debug" | "info" | "warn" | "error" | "fatal";
export type SourceType = "HTTP" | "SYSLOG_UDP" | "SYSLOG_TCP" | "FILEBEAT" | "DOCKER" | "CLOUDWATCH";
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
  sortBy?: "timestamp" | "level" | "service" | "host";
  sortDirection?: "asc" | "desc";
  limit?: number;
  offset?: number;
  pageToken?: string;
}

export interface LogSearchResult {
  logs: LogEntry[];
  total: number;
  requestId: string;
  partial: boolean;
  query: string;
  executionTimeMs: number;
  cached: boolean;
  nextPageToken?: string;
}

export interface FacetBucket {
  value: string;
  count: number;
}

export interface LogFacet {
  field: string;
  buckets: FacetBucket[];
}

export interface LogFacetQuery {
  teamId: string;
  sourceId?: string;
  startTime?: string;
  endTime?: string;
  query?: string;
  queryType: QueryType;
  filters?: LogFilter[];
  fields?: string[];
  limit?: number;
  async?: boolean;
}

export interface LogFacetResult {
  facets: LogFacet[];
}

export interface HistogramBucket {
  start: string;
  end: string;
  count: number;
}

export interface LogHistogramQuery {
  teamId: string;
  sourceId?: string;
  startTime?: string;
  endTime?: string;
  query?: string;
  queryType: QueryType;
  filters?: LogFilter[];
  interval: "minute" | "5m" | "15m" | "hour" | "day";
  async?: boolean;
}

export interface LogHistogramResult {
  interval: LogHistogramQuery["interval"];
  buckets: HistogramBucket[];
}

export interface LogPattern {
  key: string;
  signature: string;
  sampleMessage: string;
  count: number;
  latestTimestamp: string;
  level?: string;
  service?: string;
  host?: string;
}

export interface LogPatternsQuery {
  teamId: string;
  sourceId?: string;
  startTime?: string;
  endTime?: string;
  query?: string;
  queryType: QueryType;
  filters?: LogFilter[];
  groupBy?: "none" | "service" | "level" | "service_level";
  limit?: number;
  async?: boolean;
}

export interface LogPatternsResult {
  patterns: LogPattern[];
}

export interface User {
  id: string;
  email: string;
  passwordHash: string;
  name: string;
  role: "USER" | "ADMIN";
  status: "ACTIVE" | "PENDING" | "DISABLED";
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
  createdAt: string;
}

export interface TeamInvite {
  id: string;
  teamId: string;
  email?: string | null;
  token: string;
  role: "OWNER" | "ADMIN" | "MEMBER" | "VIEWER";
  createdBy: string;
  expiresAt: string;
  usedAt?: string | null;
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

export interface PendingApprovalResult {
  status: "pending_approval";
  message: string;
  user: Omit<User, "passwordHash">;
}

export type RegistrationResult = AuthResult | PendingApprovalResult;

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

export interface SavedLogViewDefinition {
  mode?: "raw" | "patterns";
  startTime?: string;
  endTime?: string;
  relativeTime?: string;
  text?: string;
  sourceId?: string;
  filters: LogFilter[];
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
