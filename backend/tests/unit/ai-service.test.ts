import { describe, expect, it } from "vitest";
import { AIService } from "../../src/services/ai/ai-service.js";

describe("AIService", () => {
  const service = new AIService();

  it("extracts error level filter from natural query", () => {
    const result = service.translateQuery("show payment errors", "team-1");
    expect(result.filtersApplied).toContainEqual({
      field: "level",
      operator: "eq",
      value: "error",
    });
  });

  it("extracts warn level filter", () => {
    const result = service.translateQuery("show me all warnings", "team-1");
    expect(result.filtersApplied).toContainEqual({
      field: "level",
      operator: "eq",
      value: "warn",
    });
  });

  it("extracts service from 'from <service>' pattern", () => {
    const result = service.translateQuery("errors from payment", "team-1");
    expect(result.filtersApplied).toContainEqual({
      field: "service",
      operator: "eq",
      value: "payment",
    });
  });

  it("generates valid SQL with team_id", () => {
    const result = service.translateQuery("show errors", "team-abc");
    expect(result.sql).toContain("team_id = 'team-abc'");
    expect(result.sql).toContain("ORDER BY timestamp DESC");
    expect(result.sql).toContain("LIMIT 100");
  });

  it("returns explanation string", () => {
    const result = service.translateQuery("show errors", "t1");
    expect(result.explanation).toBeTruthy();
    expect(typeof result.explanation).toBe("string");
  });
});
