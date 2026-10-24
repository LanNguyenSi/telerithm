import { z } from "zod";
import { SEARCH_LIMIT_CEILING } from "../constants/search.js";

// ---------------------------------------------------------------------------
// Helpers that keep the zod 3 semantics these schemas were written against:
// zod 4's native formats changed accept sets or outputs, so the old behaviour
// is pinned here; the inputs each helper must keep are pinned by
// tests/unit/zod4-compat.test.ts.
// ---------------------------------------------------------------------------

// zod 3's `.datetime()` (precision null, offset false, local false): full date
// with leap-year rules, minute precision with optional seconds and fraction,
// mandatory "Z". zod 4's `z.iso.datetime()` requires seconds and rejects
// "2026-01-01T10:00Z", which the frontend sends. The message is zod 3's.
const dateTimeSchema = z
  .string()
  .regex(
    /^((\d\d[2468][048]|\d\d[13579][26]|\d\d0[48]|[02468][048]00|[13579][26]00)-02-29|\d{4}-((0[13578]|1[02])-(0[1-9]|[12]\d|3[01])|(0[469]|11)-(0[1-9]|[12]\d|30)|(02)-(0[1-9]|1\d|2[0-8])))T([01]\d|2[0-3]):[0-5]\d(:([0-5]\d(\.\d+)?)?)?(Z)$/,
    "Invalid datetime",
  );

// zod 4's `.int()` additionally requires a *safe* integer and rejects e.g.
// 9007199254740992, which zod 3 accepted (JSON bodies and env strings can
// carry it). Number.isInteger keeps the zod 3 accept set and message.
const INT_V3_MESSAGE = "Expected integer, received float";
const intSchema = z.number().refine((value) => Number.isInteger(value), INT_V3_MESSAGE);
const coercedIntSchema = z.coerce.number().refine((value) => Number.isInteger(value), INT_V3_MESSAGE);

// zod 3's `z.number()` accepted Infinity (reachable from JSON `1e999`); zod 4's
// rejects it. NaN is rejected by both. Used where a value is a free-form
// number with no `.int()` behind it.
const numberSchema = z.custom<number>(
  (value) => typeof value === "number" && !Number.isNaN(value),
  "Expected number",
);

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
  name: z.string().trim().min(2).max(100),
  type: z.enum(["HTTP", "SYSLOG_UDP", "SYSLOG_TCP", "FILEBEAT", "DOCKER", "CLOUDWATCH"]),
});

export const renameSourceSchema = z.object({
  name: z.string().trim().min(2).max(100),
});

// Alert rules are authored through the API with the four conditions the
// evaluation worker implements. ANOMALY_DETECTED is not accepted (the worker
// skips it), and neither is a queryType other than the default: `query` is
// matched as a substring of the log message, so SQL or natural-language text
// would silently never match.
const alertRuleConditionSchema = z.enum(["GREATER_THAN", "LESS_THAN", "EQUALS", "CHANGES_BY"]);

const alertRuleFields = {
  name: z.string().trim().min(2).max(200),
  description: z.string().max(1000),
  query: z.string().trim().min(1).max(1000),
  queryType: z.literal("sql"),
  condition: alertRuleConditionSchema,
  threshold: intSchema.min(0),
  windowMinutes: intSchema.min(1).max(1440),
  enabled: z.boolean(),
};

export const createAlertRuleSchema = z.object({
  teamId: z.string().min(1),
  name: alertRuleFields.name,
  description: alertRuleFields.description.optional(),
  query: alertRuleFields.query,
  queryType: alertRuleFields.queryType.optional(),
  condition: alertRuleFields.condition,
  threshold: alertRuleFields.threshold,
  windowMinutes: alertRuleFields.windowMinutes,
  enabled: alertRuleFields.enabled.default(true),
});

// Partial update: only the keys present are changed, and the team is never
// taken from the body (it comes from the rule). `description: null` clears it.
// queryType is not editable: the worker ignores it, and create only accepts the
// default.
export const updateAlertRuleSchema = z
  .object({
    name: alertRuleFields.name.optional(),
    description: alertRuleFields.description.nullable().optional(),
    query: alertRuleFields.query.optional(),
    condition: alertRuleFields.condition.optional(),
    threshold: alertRuleFields.threshold.optional(),
    windowMinutes: alertRuleFields.windowMinutes.optional(),
    enabled: alertRuleFields.enabled.optional(),
  })
  .refine((value) => Object.values(value).some((field) => field !== undefined), {
    message: "At least one field is required",
  });

export const logFilterSchema = z.object({
  field: z.string(),
  operator: z.enum(["eq", "neq", "gt", "lt", "contains"]),
  value: z.union([z.string(), numberSchema]),
});

export const searchSchema = z.object({
  teamId: z.string().min(1),
  sourceId: z.string().optional(),
  startTime: dateTimeSchema.optional(),
  endTime: dateTimeSchema.optional(),
  query: z.string().optional(),
  queryType: z.enum(["sql", "natural"]).default("sql"),
  filters: z.array(logFilterSchema).optional(),
  sortBy: z.enum(["timestamp", "level", "service", "host"]).default("timestamp"),
  sortDirection: z.enum(["asc", "desc"]).default("desc"),
  limit: intSchema.min(1).max(SEARCH_LIMIT_CEILING).default(100),
  offset: intSchema.min(0).default(0),
  pageToken: z.string().optional(),
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
  limit: intSchema.min(1).max(50).default(10),
  async: z.boolean().default(false),
});

export const histogramSchema = searchScopeSchema.extend({
  interval: z.enum(["minute", "5m", "15m", "hour", "day"]).default("5m"),
  async: z.boolean().default(false),
});

export const patternsSchema = searchScopeSchema.extend({
  groupBy: z.enum(["none", "service", "level", "service_level"]).default("service_level"),
  limit: intSchema.min(1).max(200).default(50),
  async: z.boolean().default(false),
});

export const savedViewDefinitionSchema = z.object({
  mode: z.enum(["raw", "patterns"]).optional(),
  startTime: dateTimeSchema.optional(),
  endTime: dateTimeSchema.optional(),
  relativeTime: z.string().optional(),
  text: z.string().optional(),
  sourceId: z.string().optional(),
  filters: z.array(logFilterSchema).default([]),
  columns: z.array(z.string()).default([]),
  sortBy: z.enum(["timestamp", "level", "service", "host"]).default("timestamp"),
  sortDirection: z.enum(["asc", "desc"]).default("desc"),
  facets: z.array(z.object({ field: z.string(), value: z.string() })).default([]),
  exclusions: z.array(z.object({ field: z.string(), value: z.string() })).default([]),
  pageSize: intSchema.min(1).max(500).default(50),
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
  timestamp: dateTimeSchema,
  before: intSchema.min(1).max(100).default(20),
  after: intSchema.min(1).max(100).default(20),
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

// The EMAIL channel exists in the database enum, but no mail transport does
// (backend/src/services/notification/channels/email.ts only logs), so a new or
// changed subscription may not pick it. Existing EMAIL subscriptions are left
// alone: an update that does not send `channel` still passes.
export const EMAIL_CHANNEL_UNSUPPORTED_MESSAGE =
  "EMAIL subscriptions are not supported yet because no email transport is configured; use WEBHOOK, SLACK or MSTEAMS";

const subscriptionChannelSchema = z
  .enum(["EMAIL", "WEBHOOK", "SLACK", "MSTEAMS"])
  .refine((channel) => channel !== "EMAIL", { message: EMAIL_CHANNEL_UNSUPPORTED_MESSAGE });

export const createSubscriptionSchema = z.object({
  teamId: z.string().min(1),
  ruleId: z.string().optional(),
  channel: subscriptionChannelSchema,
  config: z.record(z.string(), z.unknown()),
  severities: z.array(z.enum(["CRITICAL", "HIGH", "MEDIUM", "LOW"])).optional(),
});

export const updateSubscriptionSchema = z.object({
  channel: subscriptionChannelSchema.optional(),
  config: z.record(z.string(), z.unknown()).optional(),
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
  limit: coercedIntSchema.min(1).max(200).default(50),
  offset: coercedIntSchema.min(0).default(0),
});

export const issueUpdateSchema = z.object({
  status: z.enum(["NEW", "ONGOING", "RESOLVED", "IGNORED"]).optional(),
  assigneeId: z.string().nullable().optional(),
});

export const muteRuleSchema = z.object({
  durationMinutes: intSchema.min(1).max(43200), // max 30 days
});

export const maintenanceWindowSchema = z.object({
  teamId: z.string().min(1),
  name: z.string().min(2),
  startsAt: dateTimeSchema,
  endsAt: dateTimeSchema,
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
          timestamp: dateTimeSchema.optional(),
          level: levelSchema.optional(),
          service: z.string().optional(),
          host: z.string().optional(),
          message: z.string().optional(),
          fields: z.record(z.string(), z.union([z.string(), numberSchema, z.boolean()])).optional(),
        }),
      ]),
    )
    .min(1),
  format: z.enum(["json", "syslog_rfc3164", "syslog_rfc5424", "plain"]).optional(),
  batchId: z.string().optional(),
});
