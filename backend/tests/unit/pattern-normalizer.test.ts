import { describe, expect, it } from "vitest";
import { normalizePatternMessage } from "../../src/services/query/pattern-normalizer.js";

describe("normalizePatternMessage", () => {
  it("replaces UUIDs, numbers, and quoted values", () => {
    const normalized = normalizePatternMessage(
      `User "alice" with id abc123 failed for request 42 and trace 550e8400-e29b-41d4-a716-446655440000`,
    );

    expect(normalized).toContain("<quoted>");
    expect(normalized).toContain("<id>");
    expect(normalized).toContain("<n>");
    expect(normalized).toContain("<uuid>");
  });

  it("replaces timestamps and hex tokens", () => {
    const normalized = normalizePatternMessage("At 2026-03-23T10:05:00Z code 0xDEADBEEF happened");
    expect(normalized).toContain("<ts>");
    expect(normalized).toContain("<hex>");
  });
});
