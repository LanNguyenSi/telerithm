# Task 001: Real AI Query Engine

**Priority:** P0
**Estimate:** 5h
**Status:** Open

## Problem

`ai-service.ts` uses regex heuristics, not real AI. The "Natural Language Search" headline promise requires actual LLM-powered query translation.

## Current State

```typescript
// Current: regex pattern matching
if (lower.includes("error")) {
  filters.push({ field: "level", operator: "eq", value: "error" });
}
```

## Solution

Replace heuristic with LLM call (OpenAI or Anthropic) that translates natural language → ClickHouse SQL.

### Architecture

```
User: "Show me payment errors from the last hour"
  → LLM prompt with ClickHouse schema context
    → SQL: SELECT * FROM logs WHERE level='error' AND service='payment' AND timestamp > now() - INTERVAL 1 HOUR
      → Execute on ClickHouse
        → Return results
```

### Implementation

```typescript
// New: LLM-based translation
async translateQuery(naturalQuery: string, teamId: string): Promise<NLQTranslation> {
  const systemPrompt = `You are a ClickHouse SQL expert.
Given the logs table schema:
  team_id String, source_id String, timestamp DateTime64(3),
  level LowCardinality(String), service LowCardinality(String),
  host LowCardinality(String), message String, fields Map(String, String)

Translate the user's natural language query into a SELECT statement.
Always filter by team_id = '${teamId}'.
Return JSON: { "sql": "...", "explanation": "..." }`;

  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",  // cheap + fast enough
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: naturalQuery },
    ],
    response_format: { type: "json_object" },
  });
  
  // Parse + validate SQL (prevent injection)
  // Execute on ClickHouse
  // Return results
}
```

## Files to Modify

```
backend/src/services/ai/ai-service.ts  — REWRITE: LLM-based translation
backend/.env.example                    — ADD: OPENAI_API_KEY
backend/src/config/index.ts             — ADD: openaiApiKey config
backend/package.json                    — ADD: openai dependency
```

## Security Notes

- **SQL Injection Prevention:** Validate generated SQL before execution
  - Only allow SELECT statements
  - Must contain `team_id = '<teamId>'` filter
  - No DROP, DELETE, INSERT, UPDATE
  - Whitelist allowed tables (logs, anomalies)
- **Rate Limiting:** LLM calls are expensive — cache common queries in Redis
- **Fallback:** If LLM fails, fall back to current heuristic

## Testing

```bash
curl -X POST http://localhost:4000/api/v1/query/natural \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"query": "show me errors from triologue-api in the last 2 hours"}'
```

Expected: Real ClickHouse SQL with actual results.
