# Task 029: NLQ Stopword Filtering and Intent Extraction

## Goal

Prevent meta-words like "logs", "entries", "events", "records" from becoming search terms in NLQ text queries. These describe the *entity being searched* (log entries), not the *content being searched for*.

## Why

Query: "show payment logs"
- AI extracts textTerms: `["logs"]` (after "payment" goes into a filter)
- "logs" matches 0 log entries because no message contains the literal word "logs"
- User gets empty results despite having 10 payment-related entries

This happens because the AI (and heuristic fallback) treat every non-stopword token as a search term, but domain-specific meta-words aren't in standard stopword lists.

## Scope

### Domain stopword list

Add a curated list of words that refer to log infrastructure, not log content:

```typescript
const DOMAIN_STOPWORDS = new Set([
  // Entity references
  "log", "logs", "entry", "entries", "event", "events",
  "record", "records", "item", "items", "row", "rows",
  // Action words (search intent, not content)
  "show", "find", "search", "get", "list", "display",
  "give", "fetch", "retrieve", "pull",
  // Demonstratives
  "me", "my", "all", "the", "a", "an",
  // Temporal meta (handled by time range inference)
  "recent", "latest", "newest", "oldest",
]);
```

### Where to apply

**1. AI service — heuristic fallback** (`ai-service.ts`):
The heuristic path already has a `stopWords` set. Extend it with domain stopwords.

**2. AI service — LLM prompt**:
Add instruction to the system prompt:
```
Do NOT include meta-words in textTerms that refer to the log system itself
(e.g. "logs", "entries", "events", "records", "errors" when used as a noun for log entries).
Only include words that should match against log message content, service names, or host names.
```

**3. Query service — textTerms post-filter** (`query-service.ts`):
Safety net after AI returns — strip domain stopwords from textTerms regardless of source:

```typescript
const DOMAIN_STOPWORDS = new Set(["log", "logs", "entry", "entries", "event", "events", ...]);

const textTerms = (translation.textTerms ?? [])
  .filter((term) => !DOMAIN_STOPWORDS.has(term.toLowerCase()))
  .filter((term) => !filterValues.has(term.toLowerCase()))
  .join(" ")
  .trim();
```

### What NOT to filter

- "error", "errors" — these are log **levels** and **content**, not just meta-words. "show me errors" means `level=error`, which the AI handles via filters. But "payment errors" means "errors" is content. Context matters → leave level-words to the AI, only filter pure meta-words.
- "failure", "failed", "timeout" — these are content words, never filter them.

## Acceptance criteria

- [ ] "show payment logs" → searches for "payment", not "payment logs"
- [ ] "find recent errors" → AI sets level=error or textTerms=["errors"], "find" and "recent" are stripped
- [ ] "show me all entries for auth-service" → textTerms empty (or just "auth-service"), not "entries"
- [ ] "connection timeout logs" → searches for "connection timeout", not "connection timeout logs"

## Test plan

- Unit test: heuristic fallback strips "logs", "show", "me" from textTerms
- Unit test: domain stopwords are removed from AI-returned textTerms
- Unit test: content words ("payment", "timeout", "failure") are NOT stripped

## Estimated effort

0.5 days

## Dependencies

- Can be done independently of task 028
- If 028 lands first, apply stopwords only in the AI path
- If done before 028, apply as post-filter in current `search()` method

## Notes

- The domain stopword list should live in a shared constant (e.g. `backend/src/constants/nlq.ts`) so both AI service and query service can import it.
- Consider making it configurable per-team in the future (some teams might have services literally named "log-service" where "log" is meaningful content).
