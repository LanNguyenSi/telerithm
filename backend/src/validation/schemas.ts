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
  slug: z.string().min(2).regex(/^[a-z0-9-]+$/),
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

export const ingestSchema = z.object({
  logs: z.array(
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
  ).min(1),
  format: z.enum(["json", "syslog_rfc3164", "syslog_rfc5424", "plain"]).optional(),
  batchId: z.string().optional(),
});

