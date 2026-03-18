# LogForge

**AI-Powered Log Analytics Platform**  
**Status:** Planning  
**Type:** Full-Stack SaaS + Self-Hosted  
**Parallelism:** Maximum (15+ components)  
**Frontend:** Next.js 15 + TypeScript + Tailwind + shadcn/ui  
**Backend:** Node.js + Express + TypeScript + ClickHouse  
**AI:** OpenAI/Anthropic API  
**Streaming:** WebSockets + Server-Sent Events

---

## 0. Vision

**Every developer knows the pain:** 3 AM outage, production down, millions of log lines, and you're grepping through terabytes of text. Hours of detective work to find the root cause.

**LogForge changes the game:**

- Natural language search: _"Show me payment failures from the last hour with amount > €100"_
- AI anomaly detection: Automatic alerts when log patterns deviate
- Root cause analysis: AI summarizes the incident and suggests fixes
- Real-time streaming: See logs as they happen, not minutes later

**Dual Model:**

- **Self-Hosted:** Open source, free, unlimited (for privacy-conscious teams)
- **Cloud:** Managed service with auto-scaling, global CDN, enterprise features

---

## 1. Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                        LOG SOURCES                                   │
├─────────────────────────────────────────────────────────────────────┤
│  • Syslog (UDP/TCP)        • HTTP API (REST)                        │
│  • Filebeat/Fluentd        • Docker Logging Driver                  │
│  • Application SDKs        • CloudWatch/S3 (import)                 │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│                      INGESTION LAYER                                 │
│                    (Node.js + Kafka)                                 │
├─────────────────────────────────────────────────────────────────────┤
│  • Log Parser (JSON, Syslog, Custom formats)                        │
│  • Schema Normalization (timestamp, level, service, message)        │
│  • Buffer/Queue (Kafka for high throughput)                         │
│  • Rate Limiting & Deduplication                                    │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│                      STORAGE LAYER                                   │
│                   (ClickHouse + Redis)                               │
├─────────────────────────────────────────────────────────────────────┤
│  • Hot Storage (ClickHouse) — 7-30 days, columnar, fast queries     │
│  • Warm Storage (S3/MinIO) — 30-90 days, compressed, cheap          │
│  • Metadata (PostgreSQL) — Users, teams, alerts, dashboards         │
│  • Cache (Redis) — Query results, sessions, real-time indices       │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│                      AI PROCESSING LAYER                             │
├─────────────────────────────────────────────────────────────────────┤
│  • Anomaly Detection (statistical + LLM pattern recognition)        │
│  • Natural Language Query → SQL Translation                         │
│  • Root Cause Analysis (incident summarization)                     │
│  • Smart Alerting (reduce noise, group related errors)              │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│                      API & REAL-TIME LAYER                           │
│                   (Node.js + WebSocket)                              │
├─────────────────────────────────────────────────────────────────────┤
│  • REST API (Query, CRUD, Management)                               │
│  • GraphQL (Flexible queries for frontend)                          │
│  • WebSocket (Real-time log streaming)                              │
│  • Alert Webhooks (Slack, PagerDuty, Custom)                        │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│                      FRONTEND                                        │
│                (Next.js 15 + TypeScript)                             │
├─────────────────────────────────────────────────────────────────────┤
│  • Dashboard (Log viewer, charts, metrics)                          │
│  • Search Interface (Natural language + Structured query builder)   │
│  • Alert Management (Rules, history, notifications)                 │
│  • Team & Settings (Members, roles, billing)                        │
│  • Live Tail (Real-time log streaming view)                         │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 2. Component Architecture

### Tier 1: Foundation (Parallel Start)

| Component | Responsibility               | Tech       | Dependencies |
| --------- | ---------------------------- | ---------- | ------------ |
| C1        | Domain Models & Types        | TypeScript | None         |
| C2        | Database Schema (PostgreSQL) | Prisma     | C1           |
| C3        | ClickHouse Schema            | SQL        | C1           |
| C4        | Log Parser Library           | TypeScript | C1           |
| C5        | Validation Layer             | Zod        | C1           |

### Tier 2: Core Infrastructure (Parallel)

| Component | Responsibility              | Dependencies |
| --------- | --------------------------- | ------------ |
| C6        | PostgreSQL Repository Layer | C2           |
| C7        | ClickHouse Repository Layer | C3           |
| C8        | Ingestion API (HTTP)        | C4, C5       |
| C9        | Syslog Receiver (UDP/TCP)   | C4           |
| C10       | Message Queue (Kafka/Bull)  | None         |

### Tier 3: AI & Processing (Parallel)

| Component | Responsibility                 | Dependencies |
| --------- | ------------------------------ | ------------ |
| C11       | AI Service (OpenAI/Anthropic)  | C1           |
| C12       | NLQ Translator (Natural → SQL) | C11          |
| C13       | Anomaly Detector               | C11, C7      |
| C14       | Root Cause Analyzer            | C11, C7      |
| C15       | Log Processor Worker           | C10, C7      |

### Tier 4: Business Logic (Parallel)

| Component | Responsibility                    | Dependencies |
| --------- | --------------------------------- | ------------ |
| C16       | Query Service (Search)            | C7, C12      |
| C17       | Alert Service (Rules, Evaluation) | C6, C7, C13  |
| C18       | Team & User Service               | C6           |
| C19       | Dashboard Service                 | C6, C7       |
| C20       | Real-time Streaming Service       | C7, Redis    |

### Tier 5: API & Integration (Sequential)

| Component | Responsibility             | Dependencies |
| --------- | -------------------------- | ------------ |
| C21       | REST Controllers           | C16-C20      |
| C22       | GraphQL Schema & Resolvers | C16-C20      |
| C23       | WebSocket Handlers         | C20          |
| C24       | Webhook Dispatcher         | C17          |

### Tier 6: Frontend (Parallel to Backend Tiers)

| Component | Responsibility          | Tier |
| --------- | ----------------------- | ---- |
| F1        | Design System           | 1    |
| F2        | API Client & Hooks      | 1    |
| F3        | Auth & User Management  | 2    |
| F4        | Log Viewer & Search UI  | 2    |
| F5        | Dashboard Builder       | 2    |
| F6        | Alert Configuration UI  | 2    |
| F7        | Live Tail View          | 3    |
| F8        | Team Management UI      | 3    |
| F9        | Settings & Billing      | 3    |
| F10       | Mobile Responsive Shell | 4    |

---

## 3. Database Schema

### PostgreSQL (Metadata & Config)

```prisma
// schema.prisma

model User {
  id            String    @id @default(uuid())
  email         String    @unique
  passwordHash  String
  name          String
  role          UserRole  @default(USER)
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt

  teams         TeamMember[]
  sessions      Session[]
  apiKeys       ApiKey[]
}

model Team {
  id            String    @id @default(uuid())
  name          String
  slug          String    @unique
  plan          Plan      @default(FREE)
  createdAt     DateTime  @default(now())

  members       TeamMember[]
  sources       LogSource[]
  alerts        AlertRule[]
  dashboards    Dashboard[]
  invitations   TeamInvitation[]
}

model TeamMember {
  id        String      @id @default(uuid())
  teamId    String
  userId    String
  role      TeamRole    @default(MEMBER)
  joinedAt  DateTime    @default(now())

  team      Team        @relation(fields: [teamId], references: [id], onDelete: Cascade)
  user      User        @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([teamId, userId])
}

model LogSource {
  id            String        @id @default(uuid())
  teamId        String
  name          String
  type          SourceType
  config        Json          // Source-specific config
  schema        Json?         // Custom field mapping
  retentionDays Int           @default(7)
  createdAt     DateTime      @default(now())

  team          Team          @relation(fields: [teamId], references: [id], onDelete: Cascade)
  apiKeys       ApiKey[]

  @@index([teamId])
}

model ApiKey {
  id          String    @id @default(uuid())
  teamId      String
  sourceId    String?
  name        String
  keyHash     String    @unique
  permissions String[]  // ['write:logs', 'read:logs', 'manage:alerts']
  lastUsedAt  DateTime?
  expiresAt   DateTime?
  createdAt   DateTime  @default(now())

  team        Team      @relation(fields: [teamId], references: [id], onDelete: Cascade)
  source      LogSource? @relation(fields: [sourceId], references: [id])
}

model AlertRule {
  id            String        @id @default(uuid())
  teamId        String
  name          String
  description   String?

  // Query configuration
  query         String        // SQL or natural language query
  queryType     QueryType     @default(SQL)

  // Threshold configuration
  condition     AlertCondition
  threshold     Int
  windowMinutes Int           @default(5)

  // Actions
  actions       AlertAction[]

  enabled       Boolean       @default(true)
  createdAt     DateTime      @default(now())
  updatedAt     DateTime      @updatedAt

  team          Team          @relation(fields: [teamId], references: [id], onDelete: Cascade)
  incidents     AlertIncident[]
}

model AlertAction {
  id          String      @id @default(uuid())
  ruleId      String
  type        ActionType
  config      Json        // { webhook: 'url', slack: 'channel', email: 'address' }

  rule        AlertRule   @relation(fields: [ruleId], references: [id], onDelete: Cascade)
}

model AlertIncident {
  id          String        @id @default(uuid())
  ruleId      String
  status      IncidentStatus @default(OPEN)
  severity    IncidentSeverity
  message     String
  details     Json?         // Query results, log samples
  resolvedAt  DateTime?
  createdAt   DateTime      @default(now())

  rule        AlertRule     @relation(fields: [ruleId], references: [id], onDelete: Cascade)
  notifications AlertNotification[]
}

model AlertNotification {
  id          String    @id @default(uuid())
  incidentId  String
  channel     String    // 'email', 'slack', 'webhook'
  recipient   String
  status      String    // 'pending', 'sent', 'failed'
  sentAt      DateTime?
  error       String?

  incident    AlertIncident @relation(fields: [incidentId], references: [id], onDelete: Cascade)
}

model Dashboard {
  id          String    @id @default(uuid())
  teamId      String
  name        String
  layout      Json      // Grid layout configuration
  isDefault   Boolean   @default(false)
  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt

  team        Team      @relation(fields: [teamId], references: [id], onDelete: Cascade)
  widgets     DashboardWidget[]
}

model DashboardWidget {
  id            String        @id @default(uuid())
  dashboardId   String
  type          WidgetType
  title         String
  query         String        // SQL query for data
  config        Json          // Visualization config
  position      Json          // { x, y, w, h }

  dashboard     Dashboard     @relation(fields: [dashboardId], references: [id], onDelete: Cascade)
}

model Session {
  id          String    @id @default(uuid())
  userId      String
  token       String    @unique
  expiresAt   DateTime
  createdAt   DateTime  @default(now())

  user        User      @relation(fields: [userId], references: [id], onDelete: Cascade)
}

// Enums
enum UserRole {
  USER
  ADMIN
}

enum TeamRole {
  OWNER
  ADMIN
  MEMBER
  VIEWER
}

enum Plan {
  FREE
  STARTER
  PRO
  ENTERPRISE
}

enum SourceType {
  HTTP
  SYSLOG_UDP
  SYSLOG_TCP
  FILEBEAT
  DOCKER
  CLOUDWATCH
}

enum QueryType {
  SQL
  NATURAL_LANGUAGE
}

enum AlertCondition {
  GREATER_THAN
  LESS_THAN
  EQUALS
  CHANGES_BY
  ANOMALY_DETECTED
}

enum ActionType {
  EMAIL
  SLACK
  WEBHOOK
  PAGERDUTY
}

enum IncidentStatus {
  OPEN
  ACKNOWLEDGED
  RESOLVED
}

enum IncidentSeverity {
  CRITICAL
  HIGH
  MEDIUM
  LOW
}

enum WidgetType {
  LINE_CHART
  BAR_CHART
  PIE_CHART
  STAT_NUMBER
  LOG_TABLE
  HEATMAP
}
```

### ClickHouse (Log Storage)

```sql
-- logs table with partitioning by day
CREATE TABLE logs (
    team_id UUID,
    source_id UUID,
    timestamp DateTime64(3),
    level LowCardinality(String),
    service LowCardinality(String),
    host LowCardinality(String),
    message String,

    -- Structured fields (JSON extracted)
    fields Nested (
        key String,
        value String
    ),

    -- Full-text search index
    INDEX idx_message message TYPE tokenbf_v1(32768, 3, 0) GRANULARITY 4,
    INDEX idx_fields fields.value TYPE bloom_filter(0.1) GRANULARITY 4
)
ENGINE = MergeTree()
PARTITION BY toYYYYMMDD(timestamp)
ORDER BY (team_id, source_id, timestamp)
TTL timestamp + INTERVAL 30 DAY;

-- Materialized view for aggregated metrics
CREATE TABLE log_metrics (
    team_id UUID,
    source_id UUID,
    bucket DateTime,
    level LowCardinality(String),
    service LowCardinality(String),
    count UInt64,
    avg_response_time Nullable Float64
)
ENGINE = SummingMergeTree()
ORDER BY (team_id, source_id, bucket, level, service);

-- Anomalies table (AI-detected)
CREATE TABLE anomalies (
    team_id UUID,
    detected_at DateTime64(3),
    anomaly_type LowCardinality(String),
    severity LowCardinality(String),
    description String,
    affected_services Array(String),
    sample_logs Array(String),
    resolved Boolean DEFAULT false
)
ENGINE = MergeTree()
ORDER BY (team_id, detected_at);
```

---

## 4. Component Specifications

### C1: Domain Models

**Tier:** 1  
**Purpose:** Shared TypeScript types across all services

```typescript
// Core log structure
export interface LogEntry {
  id: string;
  teamId: string;
  sourceId: string;
  timestamp: Date;
  level: LogLevel;
  service: string;
  host: string;
  message: string;
  fields: Record<string, string | number | boolean>;
}

export enum LogLevel {
  DEBUG = "debug",
  INFO = "info",
  WARN = "warn",
  ERROR = "error",
  FATAL = "fatal",
}

// Search & Query
export interface LogQuery {
  teamId: string;
  startTime?: Date;
  endTime?: Date;
  query?: string; // SQL or natural language
  queryType: "sql" | "natural";
  filters?: LogFilter[];
  limit?: number;
  offset?: number;
}

export interface LogFilter {
  field: string;
  operator: "eq" | "neq" | "gt" | "lt" | "contains" | "regex";
  value: string | number;
}

// AI Types
export interface AnomalyDetectionResult {
  isAnomaly: boolean;
  confidence: number;
  type?: string;
  description?: string;
  affectedServices?: string[];
}

export interface RootCauseAnalysis {
  summary: string;
  probableCauses: string[];
  suggestedActions: string[];
  relatedLogs: LogEntry[];
}

export interface NLQTranslation {
  sql: string;
  explanation: string;
  filtersApplied: LogFilter[];
}
```

### C4: Log Parser

**Tier:** 1  
**Purpose:** Parse various log formats into normalized structure

```typescript
interface LogParser {
  parse(input: string | Buffer, format: LogFormat): LogEntry[];
  detectFormat(sample: string): LogFormat;
}

enum LogFormat {
  JSON = "json",
  SYSLOG_RFC3164 = "syslog_rfc3164",
  SYSLOG_RFC5424 = "syslog_rfc5424",
  NGINX_COMBINED = "nginx_combined",
  APACHE_CLF = "apache_clf",
  CSV = "csv",
  CUSTOM = "custom",
}

// Implementation examples:
// - JSON: JSON.parse(), extract nested fields
// - Syslog: Regex parsing for priority, timestamp, host, message
// - Nginx: Regex for IP, time, method, path, status, bytes
// - Custom: User-defined regex with named capture groups
```

### C8: Ingestion API

**Tier:** 2  
**Purpose:** HTTP endpoint for log ingestion

```typescript
// POST /api/v1/ingest/:sourceId
interface IngestRequest {
  logs: LogEntry[] | string[]; // Structured or raw
  format?: LogFormat; // Auto-detected if not provided
  batchId?: string; // For deduplication
}

interface IngestResponse {
  accepted: number;
  rejected: number;
  errors?: { index: number; error: string }[];
  batchId: string;
}

// Features:
// - Authentication via API key
// - Request size limit (10MB)
// - Rate limiting per source
// - Async processing via queue
// - Acknowledgment options (sync/async)
```

### C9: Syslog Receiver

**Tier:** 2  
**Purpose:** Accept syslog streams via UDP/TCP

```typescript
// Syslog Server
interface SyslogServer {
  start(port: number, protocol: "udp" | "tcp"): void;
  stop(): void;
  onMessage(handler: (message: SyslogMessage, rinfo: RemoteInfo) => void): void;
}

// Parses RFC3164 and RFC5424 formats
// Normalizes to LogEntry structure
// Batches messages for efficient ClickHouse insertion
```

### C11: AI Service

**Tier:** 3  
**Purpose:** Interface to OpenAI/Claude for AI features

```typescript
interface AIService {
  // Natural Language → SQL
  translateQuery(
    naturalQuery: string,
    schema: TableSchema,
  ): Promise<NLQTranslation>;

  // Detect anomalies in log patterns
  detectAnomaly(
    logs: LogEntry[],
    historicalPattern?: LogPattern,
  ): Promise<AnomalyDetectionResult>;

  // Root cause analysis for incidents
  analyzeRootCause(
    incidentLogs: LogEntry[],
    context: IncidentContext,
  ): Promise<RootCauseAnalysis>;

  // Summarize large log batches
  summarizeLogs(logs: LogEntry[], maxLength?: number): Promise<string>;

  // Suggest alert rules based on log patterns
  suggestAlertRules(sampleLogs: LogEntry[]): Promise<AlertRuleSuggestion[]>;
}

// Implementation notes:
// - Use function calling for structured outputs
// - Cache common queries
// - Rate limit to control costs
// - Fallback to rule-based if AI unavailable
```

### C12: NLQ Translator

**Tier:** 3  
**Purpose:** Convert natural language to ClickHouse SQL

**Examples:**

```
Input:  "Show me all errors from the payment service in the last hour"
Output: SELECT * FROM logs
        WHERE team_id = '...'
        AND level = 'error'
        AND service = 'payment'
        AND timestamp >= now() - INTERVAL 1 HOUR

Input:  "Count 5xx responses by endpoint for the api-gateway"
Output: SELECT fields['endpoint'] as endpoint, count() as count
        FROM logs
        WHERE team_id = '...'
        AND service = 'api-gateway'
        AND fields['status_code'] >= 500
        GROUP BY endpoint
        ORDER BY count DESC

Input:  "Find slow database queries taking more than 1 second"
Output: SELECT * FROM logs
        WHERE team_id = '...'
        AND service = 'database'
        AND fields['duration_ms'] > 1000
```

### C16: Query Service

**Tier:** 4  
**Purpose:** Execute log queries with caching and optimization

```typescript
interface QueryService {
  search(query: LogQuery): Promise<LogSearchResult>;
  aggregate(
    query: LogQuery,
    aggregations: Aggregation[],
  ): Promise<AggregationResult>;
  getMetrics(timeRange: TimeRange, granularity: string): Promise<MetricsResult>;
  explainQuery(naturalQuery: string): Promise<QueryExplanation>;
}

interface LogSearchResult {
  logs: LogEntry[];
  total: number;
  query: string; // Executed SQL
  executionTimeMs: number;
  cached: boolean;
}

// Features:
// - Query caching (Redis)
// - Query optimization (rewrite slow queries)
// - Pagination support
// - Export to CSV/JSON
// - Query history per user
```

### C17: Alert Service

**Tier:** 4  
**Purpose:** Evaluate alert rules and trigger notifications

```typescript
interface AlertService {
  createRule(teamId: string, rule: CreateAlertRuleDTO): Promise<AlertRule>;
  evaluateRules(): Promise<void>; // Cron job every minute
  acknowledgeIncident(incidentId: string, userId: string): Promise<void>;
  resolveIncident(incidentId: string, resolution: string): Promise<void>;
  getIncidentHistory(
    teamId: string,
    filters?: IncidentFilters,
  ): Promise<AlertIncident[]>;
}

// Evaluation process:
// 1. Fetch all enabled rules for team
// 2. Execute rule query against ClickHouse
// 3. Compare result to threshold
// 4. If triggered: create incident, send notifications
// 5. AI enhancement: group related incidents, reduce noise
```

### F4: Log Viewer UI

**Tier:** Frontend 2  
**Purpose:** Main interface for searching and viewing logs

**Features:**

- Search bar with natural language support
- Query builder (visual filter construction)
- Results table with infinite scroll
- Log detail panel (click to expand)
- Live tail mode (real-time streaming)
- Export options (CSV, JSON)
- Save/share queries

**Components:**

```typescript
// NaturalLanguageSearch.tsx
<NaturalLanguageSearch
  onSearch={(query) => executeSearch(query)}
  suggestions={['Show errors from...', 'Count requests by...']}
/>

// LogTable.tsx
<LogTable
  logs={logs}
  onRowClick={(log) => setSelectedLog(log)}
  highlightTerms={searchTerms}
  virtualized  // For large lists
/>

// LiveTailToggle.tsx
<LiveTailToggle
  enabled={isLive}
  onToggle={(enabled) => enabled ? startStreaming() : stopStreaming()}
/>
```

---

## 5. API Specification

### REST Endpoints

**Authentication:**

```
POST   /api/v1/auth/register
POST   /api/v1/auth/login
POST   /api/v1/auth/logout
POST   /api/v1/auth/refresh
```

**Teams:**

```
POST   /api/v1/teams              → Create team
GET    /api/v1/teams              → List my teams
GET    /api/v1/teams/:id          → Get team details
PATCH  /api/v1/teams/:id          → Update team
DELETE /api/v1/teams/:id          → Delete team
POST   /api/v1/teams/:id/members  → Invite member
```

**Log Sources:**

```
POST   /api/v1/sources            → Create source
GET    /api/v1/sources            → List sources
GET    /api/v1/sources/:id        → Get source details
PATCH  /api/v1/sources/:id        → Update source
DELETE /api/v1/sources/:id        → Delete source
POST   /api/v1/sources/:id/keys   → Create API key
```

**Logs:**

```
POST   /api/v1/ingest/:sourceId   → Ingest logs
GET    /api/v1/logs               → Search logs (query params)
POST   /api/v1/logs/search        → Search logs (JSON body)
GET    /api/v1/logs/:id           → Get single log
POST   /api/v1/logs/export        → Export logs
```

**Queries:**

```
POST   /api/v1/query/natural      → Natural language query
POST   /api/v1/query/sql          → SQL query
POST   /api/v1/query/explain      → Explain query execution
GET    /api/v1/query/history      → Query history
```

**Alerts:**

```
POST   /api/v1/alerts/rules       → Create alert rule
GET    /api/v1/alerts/rules       → List rules
PATCH  /api/v1/alerts/rules/:id   → Update rule
DELETE /api/v1/alerts/rules/:id   → Delete rule
GET    /api/v1/alerts/incidents   → List incidents
POST   /api/v1/alerts/incidents/:id/ack → Acknowledge
POST   /api/v1/alerts/incidents/:id/resolve → Resolve
```

**Dashboards:**

```
GET    /api/v1/dashboards         → List dashboards
POST   /api/v1/dashboards         → Create dashboard
GET    /api/v1/dashboards/:id     → Get dashboard
PATCH  /api/v1/dashboards/:id     → Update dashboard
```

### WebSocket Events

**Client → Server:**

```
subscribe:logs    { sourceId: string, filters?: LogFilter[] }
subscribe:alerts  { teamId: string }
unsubscribe       { channel: string }
ping              {}
```

**Server → Client:**

```
log:new           LogEntry
log:batch         LogEntry[]
alert:triggered   AlertIncident
alert:resolved    { incidentId: string }
anomaly:detected  AnomalyResult
```

---

## 6. Task Board

### Backend Tasks

| ID  | Component                  | Tier | Est. Hours | Dependencies | Owner | Status |
| --- | -------------------------- | ---- | ---------- | ------------ | ----- | ------ |
| B1  | Domain Types (C1)          | 1    | 4          | None         |       | TODO   |
| B2  | PostgreSQL Schema (C2)     | 1    | 3          | B1           |       | TODO   |
| B3  | ClickHouse Schema (C3)     | 1    | 3          | B1           |       | TODO   |
| B4  | Log Parser (C4)            | 1    | 6          | B1           |       | TODO   |
| B5  | Validation (C5)            | 1    | 2          | B1           |       | TODO   |
| B6  | PG Repository (C6)         | 2    | 4          | B2           |       | TODO   |
| B7  | CH Repository (C7)         | 2    | 4          | B3           |       | TODO   |
| B8  | Ingestion API (C8)         | 2    | 4          | B4,B5        |       | TODO   |
| B9  | Syslog Receiver (C9)       | 2    | 4          | B4           |       | TODO   |
| B10 | Message Queue (C10)        | 2    | 3          | None         |       | TODO   |
| B11 | AI Interface (C11)         | 3    | 4          | B1           |       | TODO   |
| B12 | NLQ Translator (C12)       | 3    | 6          | B11          |       | TODO   |
| B13 | Anomaly Detector (C13)     | 3    | 6          | B11,B7       |       | TODO   |
| B14 | Root Cause Analyzer (C14)  | 3    | 6          | B11,B7       |       | TODO   |
| B15 | Log Processor Worker (C15) | 3    | 4          | B10,B7       |       | TODO   |
| B16 | Query Service (C16)        | 4    | 6          | B7,B12       |       | TODO   |
| B17 | Alert Service (C17)        | 4    | 6          | B6,B7,B13    |       | TODO   |
| B18 | Team Service (C18)         | 4    | 4          | B6           |       | TODO   |
| B19 | Dashboard Service (C19)    | 4    | 4          | B6,B7        |       | TODO   |
| B20 | Streaming Service (C20)    | 4    | 4          | B7           |       | TODO   |
| B21 | REST Controllers (C21)     | 5    | 6          | B16-B20      |       | TODO   |
| B22 | GraphQL (C22)              | 5    | 4          | B16-B20      |       | TODO   |
| B23 | WebSocket (C23)            | 5    | 4          | B20          |       | TODO   |
| B24 | Webhook Dispatcher (C24)   | 5    | 3          | B17          |       | TODO   |

### Frontend Tasks

| ID  | Component         | Tier | Est. Hours | Dependencies | Owner | Status |
| --- | ----------------- | ---- | ---------- | ------------ | ----- | ------ |
| F1  | Design System     | 1    | 4          | None         |       | TODO   |
| F2  | API Client        | 1    | 4          | None         |       | TODO   |
| F3  | Auth UI           | 2    | 4          | F1,F2        |       | TODO   |
| F4  | Log Viewer        | 2    | 8          | F1,F2        |       | TODO   |
| F5  | Dashboard Builder | 2    | 6          | F1,F2        |       | TODO   |
| F6  | Alert Config UI   | 2    | 6          | F1,F2        |       | TODO   |
| F7  | Live Tail         | 3    | 4          | F2           |       | TODO   |
| F8  | Team Management   | 3    | 4          | F1,F2        |       | TODO   |
| F9  | Settings          | 3    | 4          | F1,F2        |       | TODO   |
| F10 | App Shell         | 4    | 4          | All F        |       | TODO   |

**Total:** ~144 hours (Backend: 98h, Frontend: 46h)  
**With 3 developers:** ~6-7 weeks  
**MVP Scope:** B1-B15, F1-F7 (~80 hours, 3-4 weeks)

---

## 7. Directory Structure

```
logforge/
├── PROJECT.md
├── README.md
├── docker-compose.yml          # Full stack for local dev
├── Makefile                    # Common commands
│
├── backend/
│   ├── package.json
│   ├── tsconfig.json
│   ├── Dockerfile
│   ├── prisma/
│   │   └── schema.prisma       # C2
│   ├── clickhouse/
│   │   └── init.sql            # C3
│   ├── src/
│   │   ├── types/              # C1
│   │   ├── validation/         # C5
│   │   ├── parser/             # C4
│   │   ├── repositories/       # C6, C7
│   │   ├── services/
│   │   │   ├── ai/             # C11-C14
│   │   │   ├── query/          # C16
│   │   │   ├── alert/          # C17
│   │   │   ├── team/           # C18
│   │   │   ├── dashboard/      # C19
│   │   │   └── streaming/      # C20
│   │   ├── ingestion/          # C8, C9
│   │   ├── queue/              # C10
│   │   ├── workers/            # C15
│   │   ├── api/                # C21, C22
│   │   │   ├── rest/
│   │   │   └── graphql/
│   │   ├── websocket/          # C23
│   │   ├── webhooks/           # C24
│   │   ├── config/
│   │   ├── utils/
│   │   ├── app.ts
│   │   └── server.ts
│   └── tests/
│       ├── unit/
│       └── integration/
│
└── frontend/
    ├── package.json
    ├── next.config.js
    ├── tsconfig.json
    ├── Dockerfile
    ├── src/
    │   ├── app/
    │   │   ├── layout.tsx
    │   │   ├── page.tsx
    │   │   ├── (auth)/
    │   │   ├── (dashboard)/
    │   │   │   ├── logs/
    │   │   │   ├── alerts/
    │   │   │   ├── dashboards/
    │   │   │   └── settings/
    │   │   └── api/              # Next.js API routes (proxy)
    │   ├── components/
    │   │   ├── ui/               # F1
    │   │   ├── auth/             # F3
    │   │   ├── logs/             # F4, F7
    │   │   ├── dashboard/        # F5
    │   │   ├── alerts/           # F6
    │   │   ├── teams/            # F8
    │   │   └── settings/         # F9
    │   ├── lib/
    │   │   ├── api/              # F2
    │   │   ├── websocket/
    │   │   ├── utils/
    │   │   └── constants.ts
    │   ├── hooks/
    │   ├── stores/               # Zustand
    │   └── types/
    ├── public/
    └── tests/
```

---

## 8. Technology Stack

### Backend

- **Runtime:** Node.js 20 LTS
- **Framework:** Express.js 4.x
- **Language:** TypeScript 5.x (strict mode)
- **Databases:**
  - PostgreSQL 15 (metadata, config)
  - ClickHouse 24 (log storage, analytics)
  - Redis 7 (caching, sessions, real-time)
- **Queue:** BullMQ (Redis-based)
- **AI:** OpenAI GPT-4 / Claude 3 API
- **Validation:** Zod
- **Testing:** Vitest + Supertest
- **Documentation:** OpenAPI/Swagger

### Frontend

- **Framework:** Next.js 15 (App Router)
- **Language:** TypeScript 5.x
- **Styling:** Tailwind CSS 3.x
- **Components:** shadcn/ui
- **State:** Zustand
- **Data Fetching:** React Query (TanStack Query)
- **Real-time:** Socket.io-client
- **Charts:** Recharts
- **Testing:** Vitest + React Testing Library

### Infrastructure

- **Container:** Docker + Docker Compose
- **Reverse Proxy:** Traefik or Nginx
- **Monitoring:** Prometheus + Grafana (self-hosting)
- **Logs:** ...we eat our own dog food (LogForge monitors LogForge)

---

## 9. MVP Scope (Phase 1)

**Goal:** Working product in 3-4 weeks

**Included:**

- ✅ Log ingestion (HTTP API + Syslog)
- ✅ Basic search (SQL queries)
- ✅ Simple dashboard with log viewer
- ✅ Real-time streaming
- ✅ User auth & teams
- ✅ 7-day retention

**Excluded (Phase 2):**

- ⏸ AI features (NLQ, anomaly detection, RCA)
- ⏸ Advanced alerting
- ⏸ Dashboard builder (use pre-built)
- ⏸ Webhook notifications
- ⏸ Long-term storage (S3)
- ⏸ Self-hosted distribution

**Success Criteria:**

- Ingest 1000 logs/second
- Search 1M logs in < 2 seconds
- Real-time latency < 500ms
- 99.9% uptime

---

## 10. Development Workflow

### Getting Started

```bash
# 1. Clone repository
git clone https://github.com/lanforge/logforge.git
cd logforge

# 2. Start infrastructure
docker-compose up -d postgres clickhouse redis

# 3. Backend setup
cd backend
cp .env.example .env
npm install
npx prisma migrate dev
npm run dev

# 4. Frontend setup (new terminal)
cd frontend
cp .env.example .env.local
npm install
npm run dev

# 5. Open http://localhost:3000
```

### Development Rules

1. **Pick one task** from the task board
2. **Mark IN_PROGRESS** with your name
3. **Branch naming:** `feature/B12-nlq-translator`
4. **Test-driven:** Write tests before implementation
5. **Interface-first:** Define types/contracts first
6. **Update task board** when done
7. **PR requirements:**
   - All tests pass
   - TypeScript strict mode clean
   - No console.log in production code
   - Documentation updated

---

## 11. Monetization Strategy

### Self-Hosted (Open Source)

- **Free forever**
- All core features
- Community support
- Docker deployment

### Cloud Hosted

| Plan           | Price | Logs/Month | Retention | Features                                      |
| -------------- | ----- | ---------- | --------- | --------------------------------------------- |
| **Free**       | €0    | 100K       | 3 days    | Basic search, 1 source                        |
| **Starter**    | €19   | 5M         | 14 days   | +Real-time, 5 sources, email alerts           |
| **Pro**        | €49   | 25M        | 30 days   | +AI features, 20 sources, Slack, webhooks     |
| **Enterprise** | €199  | Unlimited  | 90 days   | +Custom retention, SSO, SLA, priority support |

**Add-ons:**

- Extra retention: €10/TB/month
- AI queries: €0.01/query (after 1000 free/month)

---

## 12. Competitive Advantage

**vs Datadog:** 10x cheaper, self-hostable, simpler
**vs Splunk:** Modern UI, AI-native, fraction of cost
**vs Grafana Loki:** Better search, built-in AI, easier setup
**vs SigNoz:** More mature, enterprise features, managed option

**Unique Selling Points:**

1. **AI-First:** Natural language search, anomaly detection, root cause analysis
2. **Dual Model:** Open source self-hosted + managed cloud
3. **Developer Experience:** 5-minute setup, intuitive UI, fast queries
4. **Cost Effective:** 90% cheaper than enterprise competitors

---

## 13. Success Metrics

**Technical:**

- Ingestion: 10K logs/second per node
- Query latency: P95 < 1s for 100M rows
- Availability: 99.95% uptime
- AI accuracy: >85% for NLQ translation

**Business:**

- 100 beta users in first month
- 10 paying customers by month 3
- €1K MRR by month 6
- Break-even by month 12

**Community:**

- 500 GitHub stars in 6 months
- 50 contributors
- Active Discord community

---

**Ready to build the future of log analytics?** 🚀

**Pick a Tier 1 task and let's get started.**
