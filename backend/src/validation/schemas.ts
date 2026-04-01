import { z } from "zod";

const levelSchema = z.enum(["debug", "info", "warn", "error", "fatal"]);

export const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
  name: z.string().min(2),
});

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
});

export const createTeamSchema = z.object({
  name: z.string().min(2),
  slug: z
    .string()
    .min(2)
    .regex(/^[a-z0-9-]+$/),
});

export const createSourceSchema = z.object({
  teamId: z.string().min(1),
  name: z.string().min(2),
  type: z.enum(["HTTP", "SYSLOG_UDP", "SYSLOG_TCP", "FILEBEAT", "DOCKER", "CLOUDWATCH"]),
});

export const logFilterSchema = z.object({
  field: z.string(),
  operator: z.enum(["eq", "neq", "gt", "lt", "contains"]),
  value: z.union([z.string(), z.number()]),
});

export const searchSchema = z.object({
  teamId: z.string().min(1),
  sourceId: z.string().optional(),
  startTime: z.string().datetime().optional(),
  endTime: z.string().datetime().optional(),
  query: z.string().optional(),
  queryType: z.enum(["sql", "natural"]).default("sql"),
  filters: z.array(logFilterSchema).optional(),
  sortBy: z.enum(["timestamp", "level", "service", "host"]).default("timestamp"),
  sortDirection: z.enum(["asc", "desc"]).default("desc"),
  limit: z.number().int().min(1).max(500).default(100),
  offset: z.number().int().min(0).default(0),
});

const facetFieldSchema = z.enum([
  "service",
  "level",
  "host",
  "sourceId",
  "env",
  "region",
  "status_code",
  "route",
]);

const searchScopeSchema = searchSchema.omit({
  sortBy: true,
  sortDirection: true,
  limit: true,
  offset: true,
});

export const facetsSchema = searchScopeSchema.extend({
  fields: z.array(facetFieldSchema).min(1).max(12).default(["service", "level", "host", "sourceId"]),
  limit: z.number().int().min(1).max(50).default(10),
});

export const histogramSchema = searchScopeSchema.extend({
  interval: z.enum(["minute", "5m", "15m", "hour", "day"]).default("5m"),
});

export const patternsSchema = searchScopeSchema.extend({
  groupBy: z.enum(["none", "service", "level", "service_level"]).default("service_level"),
  limit: z.number().int().min(1).max(200).default(50),
});

export const savedViewDefinitionSchema = z.object({
  mode: z.enum(["raw", "patterns"]).optional(),
  startTime: z.string().datetime().optional(),
  endTime: z.string().datetime().optional(),
  relativeTime: z.string().optional(),
  text: z.string().optional(),
  sourceId: z.string().optional(),
  filters: z.array(logFilterSchema).default([]),
  columns: z.array(z.string()).default([]),
  sortBy: z.enum(["timestamp", "level", "service", "host"]).default("timestamp"),
  sortDirection: z.enum(["asc", "desc"]).default("desc"),
  facets: z.array(z.object({ field: z.string(), value: z.string() })).default([]),
  exclusions: z.array(z.object({ field: z.string(), value: z.string() })).default([]),
  pageSize: z.number().int().min(1).max(500).default(50),
});

export const createSavedViewSchema = z.object({
  teamId: z.string().min(1),
  name: z.string().min(1).max(120),
  isShared: z.boolean().default(false),
  isDefault: z.boolean().default(false),
  definition: savedViewDefinitionSchema,
});

export const updateSavedViewSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  isShared: z.boolean().optional(),
  isDefault: z.boolean().optional(),
  definition: savedViewDefinitionSchema.optional(),
});

export const contextSchema = z.object({
  teamId: z.string().min(1),
  sourceId: z.string().min(1),
  timestamp: z.string().datetime(),
  before: z.number().int().min(1).max(100).default(20),
  after: z.number().int().min(1).max(100).default(20),
  scope: z.enum(["source", "service", "host"]).default("source"),
  service: z.string().optional(),
  host: z.string().optional(),
});

export const naturalQuerySchema = z.object({
  teamId: z.string().min(1),
  query: z.string().min(3),
});

export const incidentActionSchema = z.object({
  comment: z.string().max(1000).optional(),
});

export const createSubscriptionSchema = z.object({
  teamId: z.string().min(1),
  ruleId: z.string().optional(),
  channel: z.enum(["EMAIL", "WEBHOOK", "SLACK", "MSTEAMS"]),
  config: z.record(z.unknown()),
  severities: z.array(z.enum(["CRITICAL", "HIGH", "MEDIUM", "LOW"])).optional(),
});

export const updateSubscriptionSchema = z.object({
  channel: z.enum(["EMAIL", "WEBHOOK", "SLACK", "MSTEAMS"]).optional(),
  config: z.record(z.unknown()).optional(),
  severities: z.array(z.enum(["CRITICAL", "HIGH", "MEDIUM", "LOW"])).optional(),
  enabled: z.boolean().optional(),
});

export const issueQuerySchema = z.object({
  teamId: z.string().min(1),
  query: z.string().optional(),
  status: z.enum(["NEW", "ONGOING", "RESOLVED", "IGNORED"]).optional(),
  service: z.string().optional(),
  level: z.string().optional(),
  sortBy: z.enum(["lastSeen", "firstSeen", "eventCount", "service", "level", "status"]).default("lastSeen"),
  sortDirection: z.enum(["asc", "desc"]).default("desc"),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export const issueUpdateSchema = z.object({
  status: z.enum(["NEW", "ONGOING", "RESOLVED", "IGNORED"]).optional(),
  assigneeId: z.string().nullable().optional(),
});

export const muteRuleSchema = z.object({
  durationMinutes: z.number().int().min(1).max(43200), // max 30 days
});

export const maintenanceWindowSchema = z.object({
  teamId: z.string().min(1),
  name: z.string().min(2),
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime(),
});

export const createInviteSchema = z.object({
  role: z.enum(["ADMIN", "MEMBER", "VIEWER"]).default("MEMBER"),
  email: z.string().email().optional(),
});

export const updateUserRoleSchema = z.object({
  role: z.enum(["USER", "ADMIN"]).optional(),
  status: z.enum(["ACTIVE", "PENDING", "DISABLED"]).optional(),
  disabled: z.boolean().optional(),
});

export const addUserToTeamSchema = z.object({
  teamId: z.string().min(1),
  role: z.enum(["OWNER", "ADMIN", "MEMBER", "VIEWER"]).default("MEMBER"),
});

export const ingestSchema = z.object({
  logs: z
    .array(
      z.union([
        z.string(),
        z.object({
          timestamp: z.string().datetime().optional(),
          level: levelSchema.optional(),
          service: z.string().optional(),
          host: z.string().optional(),
          message: z.string().optional(),
          fields: z.record(z.union([z.string(), z.number(), z.boolean()])).optional(),
        }),
      ]),
    )
    .min(1),
  format: z.enum(["json", "syslog_rfc3164", "syslog_rfc5424", "plain"]).optional(),
  batchId: z.string().optional(),
});
