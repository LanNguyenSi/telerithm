import { describe, expect, it } from "vitest";
import { DOMAIN_STOPWORDS } from "../../src/constants/nlq.js";

describe("DOMAIN_STOPWORDS", () => {
  it("contains entity meta-words", () => {
    expect(DOMAIN_STOPWORDS.has("log")).toBe(true);
    expect(DOMAIN_STOPWORDS.has("logs")).toBe(true);
    expect(DOMAIN_STOPWORDS.has("entry")).toBe(true);
    expect(DOMAIN_STOPWORDS.has("entries")).toBe(true);
    expect(DOMAIN_STOPWORDS.has("events")).toBe(true);
    expect(DOMAIN_STOPWORDS.has("records")).toBe(true);
  });

  it("contains search intent words", () => {
    expect(DOMAIN_STOPWORDS.has("show")).toBe(true);
    expect(DOMAIN_STOPWORDS.has("find")).toBe(true);
    expect(DOMAIN_STOPWORDS.has("search")).toBe(true);
    expect(DOMAIN_STOPWORDS.has("get")).toBe(true);
    expect(DOMAIN_STOPWORDS.has("list")).toBe(true);
  });

  it("contains filler words", () => {
    expect(DOMAIN_STOPWORDS.has("me")).toBe(true);
    expect(DOMAIN_STOPWORDS.has("all")).toBe(true);
    expect(DOMAIN_STOPWORDS.has("the")).toBe(true);
  });

  it("does NOT contain content words that should pass through", () => {
    expect(DOMAIN_STOPWORDS.has("payment")).toBe(false);
    expect(DOMAIN_STOPWORDS.has("timeout")).toBe(false);
    expect(DOMAIN_STOPWORDS.has("failure")).toBe(false);
    expect(DOMAIN_STOPWORDS.has("failures")).toBe(false);
    expect(DOMAIN_STOPWORDS.has("auth")).toBe(false);
    expect(DOMAIN_STOPWORDS.has("checkout")).toBe(false);
  });

  it("does NOT contain log level words (those are handled by AI)", () => {
    // "error", "warning", "errors" are intentionally NOT in DOMAIN_STOPWORDS
    // because they can be both content and level indicators
    expect(DOMAIN_STOPWORDS.has("error")).toBe(false);
    expect(DOMAIN_STOPWORDS.has("errors")).toBe(false);
    expect(DOMAIN_STOPWORDS.has("warning")).toBe(false);
  });

  it("is case-insensitive friendly — all entries are lowercase", () => {
    for (const word of DOMAIN_STOPWORDS) {
      expect(word).toBe(word.toLowerCase());
    }
  });
});
