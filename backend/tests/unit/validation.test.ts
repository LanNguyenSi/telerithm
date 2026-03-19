import { describe, expect, it } from "vitest";
import {
  registerSchema,
  loginSchema,
  searchSchema,
  ingestSchema,
  createTeamSchema,
  createSourceSchema,
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
});
