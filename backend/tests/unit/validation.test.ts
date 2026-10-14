import { describe, expect, it } from "vitest";
import {
  registerSchema,
  loginSchema,
  searchSchema,
  ingestSchema,
  createTeamSchema,
  createSourceSchema,
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
