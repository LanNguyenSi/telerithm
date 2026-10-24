import express, { Router } from "express";
import supertest from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { createWriteRoute, teamFromBody } from "../../src/api/rest/write-route.js";
import {
  createAlertRuleSchema,
  createInviteSchema,
  contextSchema,
  createSubscriptionSchema,
  EMAIL_CHANNEL_UNSUPPORTED_MESSAGE,
  ingestSchema,
  loginSchema,
  maintenanceWindowSchema,
  registerSchema,
  savedViewDefinitionSchema,
  searchSchema,
  updateSubscriptionSchema,
} from "../../src/validation/schemas.js";
import type { TeamRoleName } from "../../src/api/rest/write-route.js";

// Pins for the zod 3 -> 4 migration: every case below is an input whose
// accept/reject decision or output value zod 3 made (verified on the zod 3
// lockfile before the bump) and that the zod 4 schemas must keep. The
// mutation checks in the migration report neutralise one helper each.

const loadConfigWith = async (env: Record<string, string | undefined>) => {
  const keys = [
    "DATABASE_URL",
    "CLICKHOUSE_URL",
    "TRUST_PROXY",
    "REDIS_URL",
    "OPENAI_BASE_URL",
    "ADMIN_EMAIL",
    "PORT",
    "MULTI_TENANT",
  ];
  vi.resetModules();
  for (const key of keys) delete process.env[key];
  Object.assign(process.env, env);
  return import("../../src/config/index.js");
};

describe("config url fields keep the zod 3 output (check with new URL, return the input unchanged)", () => {
  const saved: Record<string, string | undefined> = {};
  const REQUIRED = {
    DATABASE_URL: "postgresql://test:test@localhost:5432/test",
    CLICKHOUSE_URL: "http://localhost:8123",
  };

  beforeEach(() => {
    for (const key of ["DATABASE_URL", "CLICKHOUSE_URL", "TRUST_PROXY", "REDIS_URL", "OPENAI_BASE_URL", "ADMIN_EMAIL", "PORT", "MULTI_TENANT"]) {
      saved[key] = process.env[key];
    }
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    vi.resetModules();
  });

  it("accepts a DATABASE_URL with leading and trailing spaces and keeps the exact string", async () => {
    const { config } = await loadConfigWith({ ...REQUIRED, DATABASE_URL: " postgresql://u@h/db " });
    expect(config.databaseUrl).toBe(" postgresql://u@h/db ");
  });

  it("accepts a CLICKHOUSE_URL with a trailing newline and keeps the exact string", async () => {
    const { config } = await loadConfigWith({ ...REQUIRED, CLICKHOUSE_URL: "http://localhost:8123\n" });
    expect(config.clickhouseUrl).toBe("http://localhost:8123\n");
  });

  it("accepts a REDIS_URL padded with tabs and keeps the exact string", async () => {
    const { config } = await loadConfigWith({ ...REQUIRED, REDIS_URL: "\tredis://localhost:6379\t" });
    expect(config.redisUrl).toBe("\tredis://localhost:6379\t");
  });

  it("accepts an OPENAI_BASE_URL with leading and trailing spaces and keeps the exact string", async () => {
    const { config } = await loadConfigWith({ ...REQUIRED, OPENAI_BASE_URL: " http://ollama:11434 " });
    expect(config.openaiBaseUrl).toBe(" http://ollama:11434 ");
  });

  it("accepts a DATABASE_URL whose host embeds a newline (the URL parser strips it) and keeps the exact string", async () => {
    const { config } = await loadConfigWith({ ...REQUIRED, DATABASE_URL: "http://db\n.internal:5432/x" });
    expect(config.databaseUrl).toBe("http://db\n.internal:5432/x");
  });

  it("keeps the REDIS_URL default when the variable is unset", async () => {
    const { config } = await loadConfigWith({ ...REQUIRED });
    expect(config.redisUrl).toBe("redis://localhost:6379");
  });

  it("rejects a non-URL DATABASE_URL at startup naming the field and the zod 3 message", async () => {
    await expect(loadConfigWith({ ...REQUIRED, DATABASE_URL: "not a url" })).rejects.toThrow(
      /Invalid configuration:[\s\S]*databaseUrl: Invalid url/,
    );
  });

  it("rejects a non-URL OPENAI_BASE_URL at startup naming the field", async () => {
    await expect(loadConfigWith({ ...REQUIRED, OPENAI_BASE_URL: "://nope" })).rejects.toThrow(
      /Invalid configuration:[\s\S]*openaiBaseUrl/,
    );
  });
});

describe("datetime string fields keep the zod 3 accept-set", () => {
  // zod 3's .datetime() made seconds optional; zod 4's z.iso.datetime() does
  // not. The minute form is what the frontend sends.
  const sites: [string, (v: string) => boolean][] = [
    ["searchSchema.startTime", (v) => searchSchema.safeParse({ teamId: "t", startTime: v }).success],
    ["savedView.startTime", (v) => savedViewDefinitionSchema.safeParse({ startTime: v }).success],
    ["context.timestamp", (v) => contextSchema.safeParse({ teamId: "t", sourceId: "s", timestamp: v }).success],
    ["maintenanceWindow.startsAt", (v) => maintenanceWindowSchema.safeParse({ teamId: "t", name: "win", startsAt: v, endsAt: "2026-01-01T10:00:00Z" }).success],
    ["ingest.logs[0].timestamp", (v) => ingestSchema.safeParse({ logs: [{ timestamp: v }] }).success],
  ];

  it.each(sites)("%s accepts the minute-precision form 2026-01-01T10:00Z (zod 3 accepted it)", (_site, check) => {
    expect(check("2026-01-01T10:00Z")).toBe(true);
  });

  it.each(sites)("%s accepts seconds and milliseconds (zod 3 accepted them)", (_site, check) => {
    expect(check("2026-01-01T10:00:00Z")).toBe(true);
    expect(check("2026-01-01T10:00:00.123Z")).toBe(true);
    expect(check("2026-01-01T10:00:00.123456789Z")).toBe(true);
  });

  it.each(sites)("%s rejects an offset instead of Z (zod 3 rejected it)", (_site, check) => {
    expect(check("2026-01-01T10:00:00+02:00")).toBe(false);
  });

  it.each(sites)("%s rejects a datetime without Z (zod 3 rejected it)", (_site, check) => {
    expect(check("2026-01-01T10:00:00")).toBe(false);
  });

  it.each(sites)("%s rejects date-only (zod 3 rejected it)", (_site, check) => {
    expect(check("2026-01-01")).toBe(false);
  });

  it.each(sites)("%s rejects an impossible day 2026-02-30 (zod 3 rejected it)", (_site, check) => {
    expect(check("2026-02-30T10:00:00Z")).toBe(false);
  });

  it.each(sites)("%s rejects a lowercase z (zod 3 rejected it)", (_site, check) => {
    expect(check("2026-01-01T10:00:00z")).toBe(false);
  });

  it("keeps the output string unchanged (a check, not a transform)", () => {
    const result = searchSchema.safeParse({ teamId: "t", startTime: "2026-01-01T10:00Z" });
    expect(result.success && result.data.startTime).toBe("2026-01-01T10:00Z");
  });

  it("keeps the zod 3 error message for an invalid datetime", () => {
    const result = searchSchema.safeParse({ teamId: "t", startTime: "nope" });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.flatten().fieldErrors.startTime).toEqual(["Invalid datetime"]);
  });
});

describe("email fields keep the zod 3 accept-set", () => {
  it("registerSchema accepts a plus-addressed email and stores it unchanged", () => {
    const result = registerSchema.safeParse({ email: "test+tag@example.com", password: "password123", name: "AB" });
    expect(result.success && result.data.email).toBe("test+tag@example.com");
  });

  it("loginSchema accepts a short two-label email", () => {
    expect(loginSchema.safeParse({ email: "a@b.com", password: "123456" }).success).toBe(true);
  });

  it("loginSchema rejects a double dot in the local part (zod 3 rejected it)", () => {
    expect(loginSchema.safeParse({ email: "a@b..com", password: "123456" }).success).toBe(false);
  });

  it("createInviteSchema accepts an optional email", () => {
    expect(createInviteSchema.safeParse({ email: "a@b.com" }).success).toBe(true);
  });
});

describe("records keep the zod 3 accept-set and output", () => {
  it("createSubscriptionSchema.config accepts arbitrary JSON values unchanged", () => {
    const config = { a: 1, b: { c: [2] }, d: null, e: true };
    const result = createSubscriptionSchema.safeParse({ teamId: "t1", channel: "WEBHOOK", config });
    expect(result.success && result.data.config).toEqual(config);
  });

  it("createSubscriptionSchema.config accepts the empty object", () => {
    const result = createSubscriptionSchema.safeParse({ teamId: "t1", channel: "WEBHOOK", config: {} });
    expect(result.success && result.data.config).toEqual({});
  });

  it("updateSubscriptionSchema.config stays optional", () => {
    expect(updateSubscriptionSchema.safeParse({ enabled: false }).success).toBe(true);
  });

  it("ingestSchema.fields accepts the string|number|boolean union", () => {
    const result = ingestSchema.safeParse({ logs: [{ fields: { a: "s", b: 1, c: true } }] });
    expect(result.success && (result.data.logs[0] as { fields: unknown }).fields).toEqual({ a: "s", b: 1, c: true });
  });

  it("ingestSchema.fields rejects a null value (zod 3 rejected it)", () => {
    expect(ingestSchema.safeParse({ logs: [{ fields: { a: null } }] }).success).toBe(false);
  });

  it("ingestSchema.fields rejects a nested object value (zod 3 rejected it)", () => {
    expect(ingestSchema.safeParse({ logs: [{ fields: { a: { nested: 1 } } }] }).success).toBe(false);
  });
});

describe("integer fields keep the zod 3 accept-set", () => {
  const validRule = {
    teamId: "t1",
    name: "rule",
    query: "q",
    condition: "GREATER_THAN",
    threshold: 5,
    windowMinutes: 10,
  };

  it("alert threshold accepts 9007199254740992, the integer above MAX_SAFE_INTEGER that zod 3 accepted", () => {
    const result = createAlertRuleSchema.safeParse({ ...validRule, threshold: 9007199254740992 });
    expect(result.success && result.data.threshold).toBe(9007199254740992);
  });

  it("alert threshold rejects a float with the zod 3 message", () => {
    const result = createAlertRuleSchema.safeParse({ ...validRule, threshold: 1.5 });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.flatten().fieldErrors.threshold).toEqual(["Expected integer, received float"]);
    }
  });

  it("alert threshold rejects Infinity (zod 3 rejected it)", () => {
    expect(createAlertRuleSchema.safeParse({ ...validRule, threshold: Infinity }).success).toBe(false);
  });

  it("config PORT accepts an integer string above MAX_SAFE_INTEGER (zod 3 accepted it)", async () => {
    const { config } = await loadConfigWith({
      DATABASE_URL: "postgresql://test:test@localhost:5432/test",
      CLICKHOUSE_URL: "http://localhost:8123",
      PORT: "9007199254740993",
    });
    expect(config.port).toBe(9007199254740992);
  });

  it("config PORT rejects a non-numeric string naming the field", async () => {
    await expect(
      loadConfigWith({ DATABASE_URL: "postgresql://t@h/db", CLICKHOUSE_URL: "http://h:8123", PORT: "abc" }),
    ).rejects.toThrow(/Invalid configuration:[\s\S]*port/);
  });
});

describe("free-form number fields keep the zod 3 accept-set", () => {
  it("search filters accept Infinity as a filter value (zod 3 accepted it; JSON 1e999 parses to Infinity)", () => {
    const result = searchSchema.safeParse({
      teamId: "t",
      filters: [{ field: "status_code", operator: "eq", value: Infinity }],
    });
    expect(result.success && result.data.filters?.[0]?.value).toBe(Infinity);
  });

  it("search filters reject a boolean filter value (zod 3 rejected it)", () => {
    expect(
      searchSchema.safeParse({ teamId: "t", filters: [{ field: "a", operator: "eq", value: true }] }).success,
    ).toBe(false);
  });
});

describe("config defaults and transforms keep the zod 3 outputs", () => {
  const REQUIRED = {
    DATABASE_URL: "postgresql://test:test@localhost:5432/test",
    CLICKHOUSE_URL: "http://localhost:8123",
  };
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of ["DATABASE_URL", "CLICKHOUSE_URL", "TRUST_PROXY", "REDIS_URL", "OPENAI_BASE_URL", "ADMIN_EMAIL", "PORT", "MULTI_TENANT"]) {
      saved[key] = process.env[key];
    }
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    vi.resetModules();
  });

  it("MULTI_TENANT unset: the string default is still transformed to the boolean false", async () => {
    expect((await loadConfigWith({ ...REQUIRED })).config.multiTenant).toBe(false);
  });

  it('MULTI_TENANT "1" becomes true', async () => {
    expect((await loadConfigWith({ ...REQUIRED, MULTI_TENANT: "1" })).config.multiTenant).toBe(true);
  });

  it("PORT unset defaults to the number 4000", async () => {
    expect((await loadConfigWith({ ...REQUIRED })).config.port).toBe(4000);
  });

  it('PORT "50" is coerced to the number 50', async () => {
    expect((await loadConfigWith({ ...REQUIRED, PORT: "50" })).config.port).toBe(50);
  });

  it("ADMIN_EMAIL unset is undefined", async () => {
    expect((await loadConfigWith({ ...REQUIRED })).config.adminEmail).toBeUndefined();
  });

  it('ADMIN_EMAIL "" is transformed to undefined (the empty string passes the email-optional-or-"" union)', async () => {
    expect((await loadConfigWith({ ...REQUIRED, ADMIN_EMAIL: "" })).config.adminEmail).toBeUndefined();
  });

  it("ADMIN_EMAIL accepts an email and keeps it", async () => {
    expect((await loadConfigWith({ ...REQUIRED, ADMIN_EMAIL: "a@b.com" })).config.adminEmail).toBe("a@b.com");
  });

  it("ADMIN_EMAIL rejects a non-email naming the field", async () => {
    await expect(loadConfigWith({ ...REQUIRED, ADMIN_EMAIL: "nope" })).rejects.toThrow(
      /Invalid configuration:[\s\S]*adminEmail/,
    );
  });
});

describe("400 bodies keep the flattened zod 3 wire shape (formErrors + fieldErrors)", () => {
  const emptyFieldErrorSchema = z.object({ teamId: z.string().min(1) });
  const objectRefineSchema = z
    .object({ teamId: z.string().min(1), a: z.string().optional(), b: z.string().optional() })
    .refine((value) => value.a !== undefined || value.b !== undefined, {
      message: "At least one field is required",
    });
  const nestedSchema = searchSchema;

  function app() {
    const router = Router();
    const writeRoute = createWriteRoute({
      router,
      requireAuth: async () => "user-1",
      requireTeamWriteRole: async (): Promise<TeamRoleName> => "MEMBER",
    });
    writeRoute("post", "/field", teamFromBody(createSubscriptionSchema), async () => {});
    writeRoute("post", "/form", teamFromBody(objectRefineSchema), async () => {});
    writeRoute("post", "/nested", teamFromBody(nestedSchema), async () => {});
    const server = express();
    server.use(express.json());
    server.use(router);
    return server;
  }

  it("a field error answers the exact encoded body {error: {formErrors: [], fieldErrors: {channel: [message]}}}", async () => {
    const res = await supertest(app())
      .post("/field")
      .send({ teamId: "t1", channel: "EMAIL", config: {} });

    expect(res.status).toBe(400);
    expect(JSON.parse(res.text)).toEqual({
      error: { formErrors: [], fieldErrors: { channel: [EMAIL_CHANNEL_UNSUPPORTED_MESSAGE] } },
    });
  });

  it("a form-level object refine answers formErrors with the message and an empty fieldErrors map", async () => {
    const res = await supertest(app()).post("/form").send({ teamId: "t1" });

    expect(res.status).toBe(400);
    expect(JSON.parse(res.text)).toEqual({
      error: { formErrors: ["At least one field is required"], fieldErrors: {} },
    });
  });

  it("a nested path error stays flattened under the top-level key as an array of strings (zod 3 nesting)", async () => {
    const res = await supertest(app())
      .post("/nested")
      .send({ teamId: "t", filters: [{ field: 1, operator: "nope", value: true }] });

    expect(res.status).toBe(400);
    const body = JSON.parse(res.text) as { error: { formErrors: unknown[]; fieldErrors: Record<string, unknown> } };
    expect(body.error.formErrors).toEqual([]);
    expect(Object.keys(body.error.fieldErrors)).toEqual(["filters"]);
    expect(Array.isArray(body.error.fieldErrors.filters)).toBe(true);
    expect(body.error.fieldErrors.filters as string[]).toHaveLength(3);
    for (const message of body.error.fieldErrors.filters as string[]) expect(typeof message).toBe("string");
  });

  it("the teamFromBody schema of the plain harness still answers 400 with a fieldErrors map", async () => {
    const router = Router();
    const writeRoute = createWriteRoute({
      router,
      requireAuth: async () => "user-1",
      requireTeamWriteRole: async (): Promise<TeamRoleName> => "MEMBER",
    });
    writeRoute("post", "/plain", teamFromBody(emptyFieldErrorSchema), async () => {});
    const server = express();
    server.use(express.json());
    server.use(router);

    const res = await supertest(server).post("/plain").send({});
    expect(res.status).toBe(400);
    expect(JSON.parse(res.text)).toEqual({ error: { formErrors: [], fieldErrors: { teamId: expect.any(Array) } } });
  });
});
