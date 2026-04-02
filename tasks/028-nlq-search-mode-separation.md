# Task 028: NLQ Search Mode Separation

## Goal

Cleanly separate natural-language search from manual form search so they don't collide. The AI controls its own query plan; the form controls its own filters. No more merge conflicts between the two.

## Why

Today the frontend sends **everything together**: the NL query string, UI-generated filters from a previous AI plan, and whatever time range the form happens to have. The backend tries to merge AI output with user-provided filters, causing a cascade of issues:

1. **Filter collision:** AI generates `message: "payment"` → gets pruned as redundant → value sometimes lost from textTerms depending on other filter interactions.
2. **Time range mismatch:** User says "show me errors from the last hour" but the form is set to last 3 days → form wins, AI intent is ignored.
3. **Non-deterministic results:** Same query yields different results depending on what the AI returns (varies per call) and what the form state happens to be.
4. **Patch accumulation:** PRs #37, #38, #40 all patch symptoms (prune filters, recover terms, dedupe values) instead of fixing the architecture.

The root cause: two fundamentally different intents (precise manual search vs. vague natural-language search) share the same request payload and code path.

## Design

### Two distinct search modes

| Aspect | Manual mode (`queryType: "manual"`) | AI mode (`queryType: "natural"`) |
|--------|--------------------------------------|----------------------------------|
| **Time range** | Form values are truth | AI infers from query; form values are fallback |
| **Filters** | User-selected, sent as-is | AI-generated only; form state is context, not constraint |
| **Text search** | Exact — user types the search string | AI extracts textTerms from intent |
| **Expectation** | "Show me exactly what I configured" | "Understand what I mean" |

### AI mode: form state as context, not constraint

When `queryType: "natural"`, the frontend sends form state as **context hints**, not as filters:

```typescript
// Frontend sends:
{
  teamId: "...",
  query: "show me payment failures from the last hour",
  queryType: "natural",
  // Form state as context — AI may use or override
  context: {
    currentTimeRange: { startTime: "...", endTime: "..." },
    currentFilters: { level: "error", service: "api-gateway" },
    currentRelativeDuration: "24h"
  }
}
```

The AI prompt receives this context:

```
User query: "show me payment failures from the last hour"

Current UI state (for context — override if the query implies different values):
  - Time range: last 24h (2026-04-02T00:00Z to 2026-04-03T00:00Z)
  - Filters: level=error, service=api-gateway

Generate a structured query plan. If the user's query implies a different time range or different filters, use the query's intent over the form state.
```

### Manual mode: no AI involvement

When `queryType: "manual"` (or no NL query text):
- Filters, time range, text search go directly to the repository
- No AI translation, no filter merging, no textTerms extraction
- This is the current non-AI path, unchanged

### AI response drives the query

In AI mode, the backend uses **only** the AI's output:

```typescript
// AI returns:
{
  explanation: "Showing payment failures from the last hour",
  filtersApplied: [{ field: "service", operator: "contains", value: "payment" }],
  textTerms: ["payment", "failure", "failed"],
  inferredTimeRange: { startTime: "2026-04-02T13:00Z", endTime: "2026-04-02T14:00Z" },
  warnings: []
}

// Backend builds query ONLY from AI output:
// - filters: AI's filtersApplied (validated against facets)
// - textTerms: AI's textTerms (no merge with user filters)
// - timeRange: AI's inferredTimeRange ?? form context fallback
// - NO user-provided filters mixed in
```

### Heuristic fallback stays simple

If the AI service is unavailable or returns garbage:
- Heuristic extracts terms from the NL query string
- Uses form context time range as fallback
- No filter merging — heuristic generates its own filters from intent

## Implementation

### Phase 1: Backend separation (query-service.ts)

**1.1 New request shape:**

```typescript
interface LogQuery {
  teamId: string;
  queryType: "manual" | "natural";
  query?: string;
  // Manual mode: these are authoritative
  filters?: LogFilter[];
  startTime?: string;
  endTime?: string;
  // Natural mode: these are context hints
  context?: {
    currentTimeRange?: { startTime: string; endTime: string };
    currentFilters?: Record<string, string>;
    currentRelativeDuration?: string;
  };
  // Shared
  sortBy?: string;
  sortDirection?: "asc" | "desc";
  limit?: number;
  offset?: number;
}
```

**1.2 Rewrite `search()` method:**

```typescript
async search(query: LogQuery): Promise<LogSearchResult> {
  const requestId = randomUUID();

  if (query.queryType === "natural" && query.query) {
    return this.searchNatural(query, requestId);
  }

  // Manual mode — direct to repository, no AI
  return this.searchManual(query, requestId);
}

private async searchManual(query: LogQuery, requestId: string): Promise<LogSearchResult> {
  const result = await this.logRepo.search(query);
  return { ...result, requestId };
}

private async searchNatural(query: LogQuery, requestId: string): Promise<LogSearchResult> {
  const facetHints = await this.loadFacetHints(query);

  const translation = await this.aiService.translateQuery(
    query.query!,
    query.teamId,
    {
      facetHints: this.facetHintsToArrays(facetHints),
      formContext: query.context,  // NEW: pass form state to AI
    },
  );

  const validated = this.validateGeneratedFilters(translation.filtersApplied, facetHints);
  // NO user filter merging — only AI filters
  const filters = validated.filters;
  const textTerms = (translation.textTerms ?? []).join(" ").trim();

  // AI time range > form context > default
  const startTime = translation.inferredTimeRange?.startTime
    ?? query.context?.currentTimeRange?.startTime
    ?? query.startTime;
  const endTime = translation.inferredTimeRange?.endTime
    ?? query.context?.currentTimeRange?.endTime
    ?? query.endTime;

  const plannedQuery = {
    ...query,
    filters,
    startTime,
    endTime,
    queryType: "sql" as const,
    query: textTerms.length > 0 ? textTerms : query.query,
  };

  const result = await this.logRepo.search(plannedQuery);

  // Relaxed fallback: if AI filters produced 0 results, retry without filters
  if (result.total === 0 && filters.length > 0) {
    const relaxedResult = await this.logRepo.search({ ...plannedQuery, filters: [] });
    if (relaxedResult.total > 0) return { ...relaxedResult, requestId };
  }

  return { ...result, requestId };
}
```

**1.3 Simplify `validateGeneratedFilters`:**

Remove the `PrunedFilter.value` recovery logic (PR #40). No more message-term recovery needed — AI's textTerms are used directly, and message filters are simply dropped.

**1.4 Update AI service prompt:**

Add form context to the prompt so the AI can make informed decisions about time range and filters:

```typescript
// In ai-service.ts translateQuery():
let contextSection = "";
if (options?.formContext) {
  const ctx = options.formContext;
  contextSection = `\nCurrent UI state (override if the query implies different values):`;
  if (ctx.currentTimeRange) {
    contextSection += `\n  Time range: ${ctx.currentRelativeDuration ?? "custom"} (${ctx.currentTimeRange.startTime} to ${ctx.currentTimeRange.endTime})`;
  }
  if (ctx.currentFilters) {
    const active = Object.entries(ctx.currentFilters).filter(([, v]) => v);
    if (active.length > 0) {
      contextSection += `\n  Active filters: ${active.map(([k, v]) => `${k}=${v}`).join(", ")}`;
    }
  }
}
```

### Phase 2: Frontend separation (search-panel.tsx, use-log-search.ts)

**2.1 Don't send form filters in AI mode:**

```typescript
// In search-panel.tsx onSearch():
if (queryType === "natural") {
  // Send NL query + form state as context
  await searchLogs(teamId, {
    query: naturalQuery,
    queryType: "natural",
    context: {
      currentTimeRange: { startTime, endTime },
      currentFilters: { level, service, host },
      currentRelativeDuration: relativeDuration,
    },
  });
} else {
  // Send form values directly — no AI
  await searchLogs(teamId, {
    queryType: "manual",
    filters: activeFilters,
    startTime,
    endTime,
  });
}
```

**2.2 After AI search completes, hydrate form with AI's choices:**

When AI returns results, update the form to reflect what the AI decided:
- If AI set a time range → update the time picker
- If AI set filters → show them as active chips
- User can then modify and re-run as manual search

**2.3 Remove filter forwarding from NL searches:**

The `filters` array in the search request should be empty when `queryType: "natural"`. The AI generates its own.

### Phase 3: Cleanup

- Remove `PrunedFilter.value` and message-term recovery logic (obsolete)
- Remove `filterValues` deduplication between user and AI filters (no more merging)
- Remove the "prune user filters" two-phase validation (no user filters in AI mode)
- Simplify `validateGeneratedFilters` back to AI-only validation

## Migration / backward compatibility

- `queryType: "sql"` (direct ClickHouse text search) stays unchanged
- Old URL params (`startTime`, `endTime`) continue to work for form state
- API accepts both old shape (filters + query together) and new shape (context) — deprecate old shape after frontend is updated

## Acceptance criteria

- [ ] "show me payment failures" with any form state returns payment-related logs
- [ ] "show me errors from the last hour" overrides a 7-day form time range
- [ ] Manual search with level=error, service=api-gateway returns exact matches
- [ ] AI unavailable → heuristic fallback works without form filter interference
- [ ] No `message = {f0:String}` equality filters in any NLQ search
- [ ] Form updates to reflect AI's choices after NLQ search completes

## Test plan

- Unit test: `searchNatural` ignores `query.filters`, uses only AI output
- Unit test: AI time range override works when query implies "last hour"
- Unit test: form context is passed to AI prompt
- Unit test: manual search passes filters directly, no AI involvement
- Integration test: same NL query produces consistent results regardless of form state

## Estimated effort

1–2 days (backend: 0.5d, frontend: 1d, tests + cleanup: 0.5d)

## Dependencies

- Built on top of task 027
- PRs #37, #38, #40 (current patches) remain until this task lands, then their complexity is removed

## References

- PR #37: Facet validation, term expansion, relaxed fallback
- PR #38: User filter validation (two-phase)
- PR #40: Pruned message term recovery
- Root cause analysis: HAR trace showed browser sending `filters: [{message: "payment failure"}]` alongside NL query, causing filter collision
