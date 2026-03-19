import { describe, expect, it } from "vitest";
import { formatDate, levelTone } from "@/lib/utils/format";

describe("formatDate", () => {
  it("formats ISO date to German locale", () => {
    const result = formatDate("2024-06-15T10:30:00.000Z");
    expect(result).toContain("15");
    expect(result).toContain("2024");
  });
});

describe("levelTone", () => {
  it("returns danger for error", () => {
    expect(levelTone("error")).toBe("text-danger");
  });

  it("returns danger for fatal", () => {
    expect(levelTone("fatal")).toBe("text-danger");
  });

  it("returns amber for warn", () => {
    expect(levelTone("warn")).toBe("text-amber-600");
  });

  it("returns signal for info", () => {
    expect(levelTone("info")).toBe("text-signal");
  });

  it("returns muted for debug", () => {
    expect(levelTone("debug")).toBe("text-muted");
  });
});
