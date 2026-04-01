# Task 023: Phase 2 - Facets, Histogram, and Field Explorer

## Goal

Add the core exploration primitives expected from a production log tool: top-value facets, time histogram, and field discovery.

## Why

Kibana and Datadog are effective because operators can narrow scope rapidly using facets and time buckets rather than repeatedly editing raw queries.

## Scope

### Backend

- add `POST /logs/facets`
  - accepts the same search scope as `/logs/search`
  - returns counts for configured fields
- add `POST /logs/histogram`
  - accepts the same search scope plus interval
  - returns count buckets over time
- add support for facetting selected `fields[...]` keys
- define a safe allowlist or configurable registry of facetable fields

### Frontend

- add a facet sidebar with counts for:
  - service
  - level
  - host
  - sourceId
  - selected metadata fields such as `env`, `region`, `status_code`, `route`
- clicking a facet should add a query chip and refresh results
- add a histogram above the results list
  - clicking or brushing a bucket narrows the time range
- add a field explorer panel
  - visible fields in current result set
  - quick add as column
  - quick add as filter

## Files likely affected

- `frontend/src/app/(dashboard)/logs/screen.tsx`
- new frontend components for histogram and facets
- `frontend/src/lib/api/client.ts`
- `frontend/src/types/index.ts`
- `backend/src/api/rest/router.ts`
- `backend/src/validation/schemas.ts`
- `backend/src/repositories/log-repository.ts`
- `backend/src/types/domain.ts`

## API contract sketch

```ts
interface FacetBucket {
  value: string;
  count: number;
}

interface HistogramBucket {
  start: string;
  end: string;
  count: number;
}
```

## Acceptance criteria

- users can narrow results using facets without editing free text
- users can inspect query volume over time before opening individual events
- at least 4 core fields are facetable on day one
- field values from `fields` can be promoted into filters and visible columns

## Test plan

- backend integration tests for facet and histogram endpoints
- frontend tests for facet selection and histogram drilldown
- performance sanity test on representative sample data

## Dependencies

- depends on `020`
- integrates naturally with `021`

## Out of scope

- arbitrary user-defined calculated fields
- dashboard embedding

## Estimated effort

4 to 5 days
