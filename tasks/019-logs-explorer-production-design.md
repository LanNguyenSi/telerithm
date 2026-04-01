# Task 019: Logs Explorer Production Design

## Objective

Define the target architecture and implementation plan for evolving Telerithm's current demo-oriented logs page into a production-grade logs explorer comparable in workflow quality to Kibana Discover and Datadog Log Explorer.

## Current state

The current implementation already has a useful foundation:

- URL-backed pagination, sorting, and simple filters in `frontend/src/app/(dashboard)/logs/screen.tsx`
- a natural-language query entry point in `frontend/src/components/logs/search-panel.tsx`
- a tabular result view in `frontend/src/components/logs/log-table.tsx`
- SSE-based log streaming in `frontend/src/components/logs/live-tail.tsx`
- backend search validation in `backend/src/validation/schemas.ts`
- backend log search execution in `backend/src/repositories/log-repository.ts`

The main production gaps are:

- no required time range control in the UI despite `startTime` and `endTime` existing in the backend schema
- no event detail drilldown, raw JSON view, or field-level filter actions
- no facets, histograms, field statistics, or saved views
- live stream events mutate the historical result list directly
- the "Generated SQL" UI framing overstates the actual execution model
- search execution uses offset-only pagination and a very narrow query execution path

## Target product shape

The production explorer should have three primary regions:

1. Search and scope bar
   - time range
   - structured query chips
   - natural-language assist entry point
   - saved view selector
   - query execution metadata

2. Exploration surface
   - result list or table
   - optional histogram above the list
   - pattern/group mode
   - configurable visible columns

3. Context and drilldown
   - event detail drawer
   - raw JSON
   - extracted fields
   - filter/exclude actions
   - surrounding logs and related records

Live Tail must be a separate operational mode, not an implicit mutation of the historical search result set.

## Design principles

### 1. Structured exploration first

Natural language should assist structured querying, not replace it.

### 2. Deterministic state

All query state that affects results should be URL-serializable and shareable.

### 3. Event-centric drilldown

Every log row should be a starting point for deeper investigation, not a dead-end table cell.

### 4. Safe streaming

Live ingestion visibility must not corrupt, reorder, or visually pollute a bounded historical query.

### 5. Progressive scale path

The API and UI should work now with offset pagination but leave room for cursor-based search, async execution, and sampling.

## Proposed query model

Introduce a canonical explorer query model used by both frontend and backend:

```ts
interface LogExplorerQuery {
  teamId: string;
  sourceId?: string;
  startTime: string;
  endTime: string;
  text?: string;
  textMode: "simple" | "natural";
  filters: Array<{
    field: string;
    operator: "eq" | "neq" | "gt" | "gte" | "lt" | "lte" | "contains" | "in" | "exists";
    value?: string | number | boolean | Array<string | number | boolean>;
  }>;
  sortBy: "timestamp" | "level" | "service" | "host";
  sortDirection: "asc" | "desc";
  pageSize: number;
  pageToken?: string;
  offset?: number;
}
```

Notes:

- keep `offset` for backward compatibility during Phase 1 and Phase 2
- add `pageToken` in Phase 3
- rename frontend "query" semantics from pseudo-SQL framing to text/natural query framing

## Proposed API additions

### Keep

- `POST /logs/search`
- `POST /query/natural`
- `GET /stream/logs`

### Add

- `POST /logs/facets`
  - returns top values and counts for a requested set of fields
- `POST /logs/histogram`
  - returns time buckets for the active query scope
- `POST /logs/context`
  - returns before/after events around a selected anchor event
- `GET /logs/:id`
  - returns full event payload if a stable ID lookup is feasible
- `GET /logs/views`
- `POST /logs/views`
- `PATCH /logs/views/:id`
- `DELETE /logs/views/:id`
- `POST /logs/patterns`
  - initial implementation can normalize messages and group by reduced signatures

## Frontend architecture direction

### Replace the current page composition with:

- `LogQueryBar`
- `LogScopeToolbar`
- `LogHistogram`
- `LogFacetSidebar`
- `LogResultsTable`
- `LogEventDrawer`
- `LiveTailPanel`
- `SavedViewPicker`

### Keep and adapt

- `SearchPanel` becomes `LogQueryBar`
- `LogTable` becomes result table plus row selection and drawer integration
- `LiveTail` becomes an isolated stream mode with its own query scope

## Backend architecture direction

### Repository layer

Expand `LogRepository` with dedicated methods:

- `search`
- `getFacets`
- `getHistogram`
- `getContext`
- `getById`
- `getPatterns`

### Service layer

Keep natural language translation in `QueryService`, but make it output structured filters first and UI-friendly explanations second.

### Validation

Extend `backend/src/validation/schemas.ts` to support:

- richer operators
- required or defaulted time ranges for explorer endpoints
- optional cursor token
- facet and histogram request contracts

## Risks and constraints

- ClickHouse queries that aggregate on arbitrary `fields[...]` keys can become expensive without guardrails
- offset pagination will degrade at scale; plan the transition early
- event IDs based on `team_id:source_id:timestamp` may not be globally unique enough for precise context retrieval under collisions
- unrestricted NLQ-to-SQL framing creates user expectation mismatch and debugging complexity

## Non-goals

- full dashboard builder
- full tracing correlation graph
- anomaly detection or ML-based ranking in the first delivery wave
- replacing the current issue workflow

## Delivery plan

- Phase 1: operational safety and investigation basics
- Phase 2: exploration ergonomics
- Phase 3: scale, grouping, and long-term query model

Each phase is split into executable tasks in `020` through `027`.

## Acceptance criteria

- stakeholders can review one document and understand the intended end state, phase split, and API/UI evolution path
- all later phase tasks can reference this design without re-defining the same baseline assumptions
- the design reflects current repository structure and does not assume a rewrite
