# Queries

Telerithm has two query surfaces: a structured `POST /api/v1/logs/search` for filter-based searches, and `POST /api/v1/query/natural` for plain-language questions translated to a structured plan by the AI service.

This page focuses on the natural-language path: how queries are translated, what the plan looks like, and which patterns work well in practice.

## How translation works

The NLQ pipeline (see [architecture.md](architecture.md#nlq-pipeline)) takes a free-text query plus the team's current facet hints and produces a `NLQTranslation`:

```ts
type NLQTranslation = {
  explanation: string;
  filtersApplied: Array<{
    field: string;                                      // level, service, host, message, sourceId, env, region, status_code, route
    operator: "eq" | "neq" | "gt" | "lt" | "contains";
    value: string | number;
  }>;
  inferredTimeRange?: { startTime: string; endTime: string };  // ISO 8601
  textTerms?: string[];
  warnings?: string[];
};
```

The frontend renders this as editable chips: you see what the AI inferred, and you can drop, edit, or add filters before running the search.

## Calling the endpoint

```bash
curl -X POST http://localhost:4000/api/v1/query/natural \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"teamId":"team_abc","query":"payment errors in the last hour"}'
```

Response:

```json
{
  "explanation": "Filtered to service=payment and level=error over the last hour.",
  "filtersApplied": [
    { "field": "level",   "operator": "eq",       "value": "error"   },
    { "field": "service", "operator": "contains", "value": "payment" }
  ],
  "inferredTimeRange": {
    "startTime": "2026-04-28T09:14:00Z",
    "endTime":   "2026-04-28T10:14:00Z"
  },
  "textTerms": ["payment", "errors"],
  "warnings": []
}
```

## Example queries

These all translate cleanly with the LLM path. The heuristic fallback handles the simpler cases (level + service intent, last-hour time anchor) but loses nuance on multi-clause queries.

### By level

```
show me errors from the last hour
warnings only, today
critical incidents in the last 15 minutes
```

The translator emits `{ field: "level", operator: "eq", value: "error" }` and an `inferredTimeRange`.

### By service

```
billing service errors
auth-gateway warnings overnight
all logs from the payment service
```

Service intent maps to `{ field: "service", operator: "contains", value: "<name>" }`. If the candidate service isn't in the facet hints, it falls into `textTerms` instead of becoming a bogus filter.

### By field value

```
status_code 502 in checkout
route /api/orders with status above 499
host appserver-3 errors today
```

Numeric thresholds map to `gt` / `lt` operators (`status_code > 499` becomes `{ field: "status_code", operator: "gt", value: 499 }`).

### By full-text content

```
payment authorization failed
connection reset by peer
out of memory
```

Plain phrases become `textTerms` searched against the `message` field. The translator also expands common variants (fail / failed / failure / failures / failing).

### Combined

```
payment service errors with status_code 502 in the last hour
auth-gateway warnings about token expiration today
billing critical incidents from us-east-1 in the last 15 minutes
```

The AI plans a multi-filter query plus inferred time range plus residual text terms.

## Prompt patterns that work

Treat the system prompt as a contract; the user query is everything you'd write into a search box. The translator is tuned for:

- **Time anchors.** "last hour", "today", "yesterday", "in the last 15 minutes", "overnight" produce an `inferredTimeRange`.
- **Level keywords.** "error", "errors", "warn", "warning", "critical" map to `level` filters.
- **Service intent.** "from <name>", "<name> service", or a bare service name match to the facet hints produce a `service` `contains` filter.
- **Field comparisons.** "status_code 502", "above 499", "below 100" produce numeric `eq` / `gt` / `lt` filters.
- **Free text.** Anything not classified above lands in `textTerms` for full-text search against `message`.

## Patterns that don't work (yet)

- **Aggregations.** "count errors by service" is not part of the structured plan, the NLQ endpoint is a search planner, not a SQL generator. Use `/logs/search` and the histogram view for counts.
- **Multi-source joins.** "errors in service A that correlate with warnings in service B" returns a single filter set, no temporal correlation.
- **Pagination intent.** "show me the next 100" doesn't carry over from a previous call, the endpoint is stateless per call.

## Heuristic fallback

When `OPENAI_API_KEY` is unset, or after retry exhaustion on a transient LLM error, `AIService.translateQueryHeuristicPublic` runs instead. It uses regex-based level and service detection plus stop-word-filtered text terms, and the response always includes:

```json
{ "warnings": ["AI fallback mode active: heuristic interpretation was used."] }
```

The UI uses this flag to badge the result so users know they're not seeing the LLM's interpretation.

## Domain stop words

The translator strips common log-domain noise words (e.g. "service", "log", "logs", "show", "me") before extracting text terms, so they don't pollute the search. The full list lives in `backend/src/constants/nlq.ts` (`DOMAIN_STOPWORDS`).

## Tuning

For a self-hosted install with low query volume, the default `gpt-4o-mini`-class cloud model or a 4B-7B local model produces good plans. Larger models help on multi-clause queries with implicit time anchors. The `OPENAI_MODEL` env var picks the model, see [configuration.md](configuration.md#ai-provider-configuration).
