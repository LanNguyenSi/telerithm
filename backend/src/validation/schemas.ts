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
  limit: z.number().int().min(1).max(500).default(100),
  offset: z.number().int().min(0).default(0),
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
  status: z.enum(["NEW", "ONGOING", "RESOLVED", "IGNORED"]).optional(),
  service: z.string().optional(),
  level: z.string().optional(),
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
  disabled: z.boolean().optional(),
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
