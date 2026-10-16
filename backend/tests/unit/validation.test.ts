import { describe, expect, it } from "vitest";
import {
  registerSchema,
  loginSchema,
  searchSchema,
  ingestSchema,
  createTeamSchema,
  createSourceSchema,
  createAlertRuleSchema,
  updateAlertRuleSchema,
  createSubscriptionSchema,
  updateSubscriptionSchema,
  EMAIL_CHANNEL_UNSUPPORTED_MESSAGE,
} from "../../src/validation/schemas.js";

describe("Validation Schemas", () => {
  describe("registerSchema", () => {
    it("accepts valid registration", () => {
      const result = registerSchema.safeParse({
        email: "test@example.com",
        password: "password123",
        name: "Test User",
      });
      expect(result.success).toBe(true);
    });

    it("rejects invalid email", () => {
      const result = registerSchema.safeParse({
        email: "not-an-email",
        password: "password123",
        name: "Test",
      });
      expect(result.success).toBe(false);
    });

    it("rejects short password", () => {
      const result = registerSchema.safeParse({
        email: "test@example.com",
        password: "12345",
        name: "Test",
      });
      expect(result.success).toBe(false);
    });

    it("rejects short name", () => {
      const result = registerSchema.safeParse({
        email: "test@example.com",
        password: "password123",
        name: "X",
      });
      expect(result.success).toBe(false);
    });
  });

  describe("loginSchema", () => {
    it("accepts valid login", () => {
      expect(loginSchema.safeParse({ email: "a@b.com", password: "123456" }).success).toBe(true);
    });
  });

  describe("searchSchema", () => {
    it("accepts minimal search", () => {
      const result = searchSchema.safeParse({ teamId: "t1" });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.queryType).toBe("sql");
        expect(result.data.limit).toBe(100);
        expect(result.data.offset).toBe(0);
      }
    });

    it("rejects limit above 500", () => {
      const result = searchSchema.safeParse({ teamId: "t1", limit: 1000 });
      expect(result.success).toBe(false);
    });

    it("accepts natural query type", () => {
      const result = searchSchema.safeParse({
        teamId: "t1",
        query: "show errors",
        queryType: "natural",
      });
      expect(result.success).toBe(true);
    });
  });

  describe("ingestSchema", () => {
    it("accepts string logs", () => {
      const result = ingestSchema.safeParse({ logs: ["line 1", "line 2"] });
      expect(result.success).toBe(true);
    });

    it("accepts object logs", () => {
      const result = ingestSchema.safeParse({
        logs: [{ message: "test", level: "error" }],
      });
      expect(result.success).toBe(true);
    });

    it("rejects empty logs array", () => {
      const result = ingestSchema.safeParse({ logs: [] });
      expect(result.success).toBe(false);
    });
  });

  describe("createTeamSchema", () => {
    it("accepts valid team", () => {
      expect(createTeamSchema.safeParse({ name: "My Team", slug: "my-team" }).success).toBe(true);
    });

    it("rejects slug with uppercase", () => {
      expect(createTeamSchema.safeParse({ name: "My Team", slug: "My-Team" }).success).toBe(false);
    });
  });

  describe("createSourceSchema", () => {
    it("accepts valid source", () => {
      const result = createSourceSchema.safeParse({
        teamId: "t1",
        name: "my-api",
        type: "HTTP",
      });
      expect(result.success).toBe(true);
    });

    it("rejects invalid source type", () => {
      const result = createSourceSchema.safeParse({
        teamId: "t1",
        name: "my-api",
        type: "INVALID",
      });
      expect(result.success).toBe(false);
    });
  });

  describe("alert rule schemas", () => {
    const valid = {
      teamId: "t1",
      name: "High error rate",
      query: "timeout",
      condition: "GREATER_THAN",
      threshold: 5,
      windowMinutes: 10,
    };

    it("accepts a valid rule and defaults enabled to true", () => {
      const result = createAlertRuleSchema.safeParse(valid);
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.enabled).toBe(true);
    });

    it.each(["GREATER_THAN", "LESS_THAN", "EQUALS", "CHANGES_BY"])("accepts condition %s", (condition) => {
      expect(createAlertRuleSchema.safeParse({ ...valid, condition }).success).toBe(true);
    });

    it("rejects ANOMALY_DETECTED", () => {
      expect(createAlertRuleSchema.safeParse({ ...valid, condition: "ANOMALY_DETECTED" }).success).toBe(
        false,
      );
      expect(updateAlertRuleSchema.safeParse({ condition: "ANOMALY_DETECTED" }).success).toBe(false);
    });

    it("rejects a queryType other than sql", () => {
      expect(createAlertRuleSchema.safeParse({ ...valid, queryType: "natural" }).success).toBe(false);
      expect(createAlertRuleSchema.safeParse({ ...valid, queryType: "sql" }).success).toBe(true);
    });

    it("does not carry queryType through an update", () => {
      const result = updateAlertRuleSchema.safeParse({ name: "Renamed", queryType: "natural" });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data).toEqual({ name: "Renamed" });
    });

    it("trims the name before the minimum length applies", () => {
      expect(createAlertRuleSchema.safeParse({ ...valid, name: "  a  " }).success).toBe(false);
      const result = createAlertRuleSchema.safeParse({ ...valid, name: "  ab  " });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.name).toBe("ab");
    });

    it.each([
      ["a name of 201 characters", { name: "n".repeat(201) }],
      ["a description of 1001 characters", { description: "d".repeat(1001) }],
      ["a query of 1001 characters", { query: "q".repeat(1001) }],
    ])("rejects %s", (_label, patch) => {
      expect(createAlertRuleSchema.safeParse({ ...valid, ...patch }).success).toBe(false);
      expect(updateAlertRuleSchema.safeParse(patch).success).toBe(false);
    });

    it("accepts the upper length bounds", () => {
      const patch = { name: "n".repeat(200), description: "d".repeat(1000), query: "q".repeat(1000) };
      expect(createAlertRuleSchema.safeParse({ ...valid, ...patch }).success).toBe(true);
    });

    it.each([
      ["a one character name", { name: "a" }],
      ["a blank query", { query: "   " }],
      ["a negative threshold", { threshold: -1 }],
      ["a fractional threshold", { threshold: 1.5 }],
      ["a zero window", { windowMinutes: 0 }],
      ["a window above 1440", { windowMinutes: 1441 }],
      ["a non-boolean enabled", { enabled: "yes" }],
    ])("rejects %s", (_label, patch) => {
      expect(createAlertRuleSchema.safeParse({ ...valid, ...patch }).success).toBe(false);
    });

    it("accepts the window bounds 1 and 1440 and threshold 0", () => {
      expect(createAlertRuleSchema.safeParse({ ...valid, windowMinutes: 1, threshold: 0 }).success).toBe(
        true,
      );
      expect(createAlertRuleSchema.safeParse({ ...valid, windowMinutes: 1440 }).success).toBe(true);
    });

    it("update accepts a single field and a null description, and rejects an empty body", () => {
      expect(updateAlertRuleSchema.safeParse({ enabled: false }).success).toBe(true);
      expect(updateAlertRuleSchema.safeParse({ description: null }).success).toBe(true);
      expect(updateAlertRuleSchema.safeParse({}).success).toBe(false);
    });

    it("update drops a teamId in the body, so a rule cannot be moved between teams", () => {
      const result = updateAlertRuleSchema.safeParse({ enabled: true, teamId: "other" });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data).not.toHaveProperty("teamId");
    });
  });

  describe("subscription channels", () => {
    const base = { teamId: "t1", config: {} };

    it("createSubscriptionSchema rejects EMAIL with the reason on the channel field", () => {
      const result = createSubscriptionSchema.safeParse({ ...base, channel: "EMAIL" });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.flatten().fieldErrors.channel).toEqual([EMAIL_CHANNEL_UNSUPPORTED_MESSAGE]);
      }
      expect(EMAIL_CHANNEL_UNSUPPORTED_MESSAGE).toMatch(/no email transport/);
    });

    it.each(["WEBHOOK", "SLACK", "MSTEAMS"])("createSubscriptionSchema accepts %s", (channel) => {
      expect(createSubscriptionSchema.safeParse({ ...base, channel }).success).toBe(true);
    });

    it("createSubscriptionSchema still rejects an unknown channel", () => {
      expect(createSubscriptionSchema.safeParse({ ...base, channel: "SMS" }).success).toBe(false);
    });

    it("updateSubscriptionSchema rejects switching to EMAIL", () => {
      const result = updateSubscriptionSchema.safeParse({ channel: "EMAIL" });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.flatten().fieldErrors.channel).toEqual([EMAIL_CHANNEL_UNSUPPORTED_MESSAGE]);
      }
    });

    it("updateSubscriptionSchema accepts an update that leaves the channel alone (existing EMAIL subscriptions)", () => {
      expect(updateSubscriptionSchema.safeParse({ enabled: false }).success).toBe(true);
      expect(updateSubscriptionSchema.safeParse({ severities: ["HIGH"] }).success).toBe(true);
    });

    it("updateSubscriptionSchema accepts the other channels", () => {
      expect(updateSubscriptionSchema.safeParse({ channel: "SLACK" }).success).toBe(true);
    });
  });
});
