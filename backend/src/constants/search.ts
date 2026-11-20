/**
 * Upper bound of the `limit` a log search request may ask for. The request
 * schema enforces it for every caller, and the `MAX_PAGE_SIZE` setting can lower
 * the effective maximum but never raise it above this value.
 */
export const SEARCH_LIMIT_CEILING = 500;

/**
 * Upper bound, in characters, of the free-text search input: the `query` of a
 * log search (and of the scope schemas that extend it) and the `query` of a
 * natural-language request. It is a free-text box typed by a person; the alert
 * rule `query`, the closest authored-input comparison, stops at 1000.
 */
export const SEARCH_QUERY_MAX_LENGTH = 2000;

/**
 * Upper bound of the `filters` array of a search request or of the equivalent
 * filter-shaped lists of a saved-view definition. The UI sends up to three form
 * filters plus one row per clicked facet or exclusion.
 */
export const SEARCH_FILTERS_MAX = 100;

/** Upper bound, in characters, of a filter `field` (a facet field or attribute key). */
export const SEARCH_FILTER_FIELD_MAX_LENGTH = 200;

/**
 * Upper bound, in characters, of the string branch of a filter `value` (a facet
 * value or typed text). The number branch is not length-limited.
 */
export const SEARCH_FILTER_VALUE_MAX_LENGTH = 2000;

/**
 * Upper bound of the distinct search tokens one query may contribute to the
 * tokenized text condition. Every token expands to one or more ILIKE variant
 * groups, so this bounds the number of query parameters and OR'ed conditions of
 * the generated ClickHouse SQL whatever the request's total length is.
 */
export const SEARCH_QUERY_MAX_TOKENS = 64;

/**
 * The token list a search `query` expands into: split on whitespace, lowercased,
 * stripped to `[a-z0-9_-]`, tokens of one character or less dropped, duplicates
 * collapsed in first-occurrence order. Both the route-level cap (which answers
 * 400 past SEARCH_QUERY_MAX_TOKENS) and the repository's condition builder use
 * this one tokenizer, so the count the route rejects is exactly the count the
 * repository would execute.
 */
export function searchQueryTokens(query: string): string[] {
  const tokens = new Set<string>();
  for (const raw of query.split(/\s+/)) {
    const token = raw
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, "")
      .trim();
    if (token.length > 1) {
      tokens.add(token);
    }
  }
  return [...tokens];
}
