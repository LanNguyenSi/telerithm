import { describe, expect, it } from "vitest";
import {
  SEARCH_FILTER_FIELD_MAX_LENGTH,
  SEARCH_FILTERS_MAX,
  SEARCH_FILTER_VALUE_MAX_LENGTH,
  SEARCH_QUERY_MAX_LENGTH,
  SEARCH_QUERY_MAX_TOKENS,
  searchQueryTokens,
} from "../../src/constants/search.js";
import {
  createTeamSchema,
  facetsSchema,
  histogramSchema,
  naturalQuerySchema,
  patternsSchema,
  registerSchema,
  savedViewDefinitionSchema,
  searchSchema,
} from "../../src/validation/schemas.js";

function repeatedChar(length: number, char = "q"): string {
  return char.repeat(length);
}

function filterList(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    field: `field_${i}`,
    operator: "eq" as const,
    value: `value_${i}`,
  }));
}

describe("search input limits (query length)", () => {
  it("accepts a query of exactly the maximum length", () => {
    const result = searchSchema.safeParse({ teamId: "t1", query: repeatedChar(SEARCH_QUERY_MAX_LENGTH) });
    expect(result.success).toBe(true);
  });

  it("rejects a query one character over the maximum", () => {
    expect(searchSchema.safeParse({ teamId: "t1", query: repeatedChar(SEARCH_QUERY_MAX_LENGTH + 1) }).success).toBe(
      false,
    );
  });

  it.each([
    ["facetsSchema", facetsSchema],
    ["histogramSchema", histogramSchema],
    ["patternsSchema", patternsSchema],
  ])("%s inherits the query cap through the search scope", (_name, schema) => {
    expect(schema.safeParse({ teamId: "t1", query: repeatedChar(SEARCH_QUERY_MAX_LENGTH) }).success).toBe(true);
    expect(
      schema.safeParse({ teamId: "t1", query: repeatedChar(SEARCH_QUERY_MAX_LENGTH + 1) }).success,
    ).toBe(false);
  });

  it("naturalQuerySchema caps the query at the same maximum and keeps the minimum", () => {
    expect(
      naturalQuerySchema.safeParse({ teamId: "t1", query: repeatedChar(SEARCH_QUERY_MAX_LENGTH, "q") }).success,
    ).toBe(true);
    expect(
      naturalQuerySchema.safeParse({
        teamId: "t1",
        query: repeatedChar(SEARCH_QUERY_MAX_LENGTH + 1, "q"),
      }).success,
    ).toBe(false);
    expect(naturalQuerySchema.safeParse({ teamId: "t1", query: "ab" }).success).toBe(false);
  });
});

describe("search input limits (filters, field, value)", () => {
  it("accepts exactly the maximum number of filters", () => {
    expect(searchSchema.safeParse({ teamId: "t1", filters: filterList(SEARCH_FILTERS_MAX) }).success).toBe(true);
  });

  it("rejects one filter over the maximum", () => {
    expect(searchSchema.safeParse({ teamId: "t1", filters: filterList(SEARCH_FILTERS_MAX + 1) }).success).toBe(
      false,
    );
  });

  it("accepts a filter field of exactly the maximum length and rejects one more character", () => {
    const at = { field: repeatedChar(SEARCH_FILTER_FIELD_MAX_LENGTH, "f"), operator: "eq", value: "x" };
    const over = { field: repeatedChar(SEARCH_FILTER_FIELD_MAX_LENGTH + 1, "f"), operator: "eq", value: "x" };
    expect(searchSchema.safeParse({ teamId: "t1", filters: [at] }).success).toBe(true);
    expect(searchSchema.safeParse({ teamId: "t1", filters: [over] }).success).toBe(false);
  });

  it("accepts a string filter value of exactly the maximum length and rejects one more character", () => {
    const at = { field: "service", operator: "eq", value: repeatedChar(SEARCH_FILTER_VALUE_MAX_LENGTH, "v") };
    const over = {
      field: "service",
      operator: "eq",
      value: repeatedChar(SEARCH_FILTER_VALUE_MAX_LENGTH + 1, "v"),
    };
    expect(searchSchema.safeParse({ teamId: "t1", filters: [at] }).success).toBe(true);
    expect(searchSchema.safeParse({ teamId: "t1", filters: [over] }).success).toBe(false);
  });

  it("does not length-limit the number branch of the filter value", () => {
    expect(searchSchema.safeParse({ teamId: "t1", filters: [{ field: "n", operator: "eq", value: 1e999 }] }).success).toBe(
      true,
    );
    expect(searchSchema.safeParse({ teamId: "t1", filters: [{ field: "n", operator: "gt", value: 0 }] }).success).toBe(
      true,
    );
  });
});

describe("search token cap (tokenizer shared by route and repository)", () => {
  it("splits on whitespace, lowercases, strips other characters and drops one-character tokens", () => {
    expect(searchQueryTokens("  Payment-FAILURE!  timeout   a 500 ")).toEqual([
      "payment-failure",
      "timeout",
      "500",
    ]);
  });

  it("dedupes: repeats of one token count once", () => {
    expect(searchQueryTokens("alpha beta alpha BETA alpha!")).toEqual(["alpha", "beta"]);
  });

  it("a query of exactly the maximum distinct tokens counts as the maximum", () => {
    const query = Array.from({ length: SEARCH_QUERY_MAX_TOKENS }, (_, i) => `tok${i}`).join(" ");
    expect(searchQueryTokens(query)).toHaveLength(SEARCH_QUERY_MAX_TOKENS);
  });

  it("a query one distinct token over the maximum counts past it (and stays under the length cap)", () => {
    const query = Array.from({ length: SEARCH_QUERY_MAX_TOKENS + 1 }, (_, i) => `tok${i}`).join(" ");
    expect(query.length).toBeLessThan(SEARCH_QUERY_MAX_LENGTH);
    expect(searchQueryTokens(query)).toHaveLength(SEARCH_QUERY_MAX_TOKENS + 1);
  });
});

describe("saved-view definition limits", () => {
  it("accepts text at the maximum and rejects one character over", () => {
    expect(savedViewDefinitionSchema.safeParse({ text: repeatedChar(SEARCH_QUERY_MAX_LENGTH) }).success).toBe(
      true,
    );
    expect(
      savedViewDefinitionSchema.safeParse({ text: repeatedChar(SEARCH_QUERY_MAX_LENGTH + 1) }).success,
    ).toBe(false);
  });

  it("accepts the maximum number of filters and rejects one more", () => {
    expect(savedViewDefinitionSchema.safeParse({ filters: filterList(SEARCH_FILTERS_MAX) }).success).toBe(true);
    expect(savedViewDefinitionSchema.safeParse({ filters: filterList(SEARCH_FILTERS_MAX + 1) }).success).toBe(
      false,
    );
  });

  it.each(["facets", "exclusions"] as const)(
    "applies the filters count and the field/value string caps to %s entries",
    (list) => {
      const facetList = (count: number) =>
        Array.from({ length: count }, (_, i) => ({ field: `f${i}`, value: "v" }));
      expect(savedViewDefinitionSchema.safeParse({ [list]: facetList(SEARCH_FILTERS_MAX) }).success).toBe(true);
      expect(savedViewDefinitionSchema.safeParse({ [list]: facetList(SEARCH_FILTERS_MAX + 1) }).success).toBe(
        false,
      );
      expect(
        savedViewDefinitionSchema.safeParse({
          [list]: [{ field: repeatedChar(SEARCH_FILTER_FIELD_MAX_LENGTH, "f"), value: "v" }],
        }).success,
      ).toBe(true);
      expect(
        savedViewDefinitionSchema.safeParse({
          [list]: [{ field: repeatedChar(SEARCH_FILTER_FIELD_MAX_LENGTH + 1, "f"), value: "v" }],
        }).success,
      ).toBe(false);
      expect(
        savedViewDefinitionSchema.safeParse({
          [list]: [{ field: "f", value: repeatedChar(SEARCH_FILTER_VALUE_MAX_LENGTH, "v") }],
        }).success,
      ).toBe(true);
      expect(
        savedViewDefinitionSchema.safeParse({
          [list]: [{ field: "f", value: repeatedChar(SEARCH_FILTER_VALUE_MAX_LENGTH + 1, "v") }],
        }).success,
      ).toBe(false);
    },
  );

  it("keeps an existing minimal definition parseable", () => {
    const result = savedViewDefinitionSchema.safeParse({});
    expect(result.success).toBe(true);
  });
});

describe("display-name caps", () => {
  it("registerSchema accepts a name of 100 characters and rejects 101", () => {
    const base = { email: "a@b.com", password: "secret123" };
    expect(registerSchema.safeParse({ ...base, name: "n".repeat(100) }).success).toBe(true);
    expect(registerSchema.safeParse({ ...base, name: "n".repeat(101) }).success).toBe(false);
  });

  it("createTeamSchema accepts a name of 100 characters and rejects 101", () => {
    expect(createTeamSchema.safeParse({ name: "n".repeat(100), slug: "team" }).success).toBe(true);
    expect(createTeamSchema.safeParse({ name: "n".repeat(101), slug: "team" }).success).toBe(false);
  });
});
