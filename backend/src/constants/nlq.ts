/**
 * Domain-specific stopwords for NLQ (Natural Language Query) processing.
 *
 * These words refer to the log infrastructure itself, not the log content.
 * Filtering them prevents empty results when users say things like
 * "show payment logs" (where "logs" should not become a search term).
 *
 * What NOT to include:
 * - "error", "errors", "warning", "failure" — these are content words and log levels
 * - Service/host names — these are meaningful content
 * - "timeout", "failed" — always content words
 */
export const DOMAIN_STOPWORDS = new Set([
  // Entity references — describe the thing being searched, not its content
  "log",
  "logs",
  "entry",
  "entries",
  "event",
  "events",
  "record",
  "records",
  "item",
  "items",
  "row",
  "rows",
  // Search intent / action words
  "show",
  "find",
  "search",
  "get",
  "list",
  "display",
  "give",
  "fetch",
  "retrieve",
  "pull",
  // Filler words
  "me",
  "my",
  "all",
  "the",
  "a",
  "an",
  // Temporal meta (time range handled separately)
  "recent",
  "latest",
  "newest",
  "oldest",
]);

/**
 * Instruction appended to the LLM system prompt to prevent meta-words
 * from leaking into textTerms.
 */
export const NLQ_STOPWORD_PROMPT_HINT = `
IMPORTANT: Do NOT include meta-words in textTerms that refer to the log system itself.
Words like "logs", "entries", "events", "records", "show", "find", "me", "all", "recent"
describe the search intent, not the log content — exclude them from textTerms entirely.
Only include words that should match against log message content, service names, or host names.
`;
