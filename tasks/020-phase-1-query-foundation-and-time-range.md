# Task 020: Phase 1 - Query Foundation and Time Range

## Goal

Make the logs explorer operationally safe and predictable by introducing explicit time scoping, a clearer query model, and URL-backed query chips.

## Why

The current logs page can run broad searches without a visible time range and exposes only a subset of backend search capabilities. In production this leads to imprecise results, expensive queries, and poor shareability.

## Scope

### Frontend

- replace the current "Natural Language Search" framing with a combined query bar:
  - free text input
  - natural-language assist affordance
  - explicit time range picker
  - visible filter chips
  - clear reset action
- include `startTime` and `endTime` in URL state
- expose `sourceId` in the query UI when available
- show execution summary as:
  - total results
  - execution time
  - active time range
- reduce SQL preview prominence
  - relabel as "AI interpretation" or "generated filter plan"
  - do not present it as the core search artifact

### Backend

- enforce a bounded time range for `/logs/search`
  - either required in request
  - or default to a safe range such as last 15 minutes or last 1 hour
- update search schema to validate the time range and reject invalid intervals
- ensure search results are deterministic when multiple rows share the same timestamp
  - add a secondary sort key

## Files likely affected

- `frontend/src/app/(dashboard)/logs/screen.tsx`
- `frontend/src/components/logs/search-panel.tsx`
- `frontend/src/lib/api/client.ts`
- `frontend/src/types/index.ts`
- `backend/src/validation/schemas.ts`
- `backend/src/api/rest/router.ts`
- `backend/src/types/domain.ts`
- `backend/src/repositories/log-repository.ts`

## Deliverables

- a time range control on the logs page
- URL state for time range and source filter
- structured filter chips in the UI
- safer search request defaults in the backend
- updated API typing across frontend and backend

## Acceptance criteria

- every logs search is scoped by a visible time range
- refreshing or sharing the page preserves the search scope
- invalid time ranges return a clear API error
- the logs page still supports the existing `level`, `service`, and `host` filters
- the UI no longer suggests that arbitrary SQL is being directly executed

## Test plan

- frontend tests for URL-state hydration and time-range persistence
- backend validation tests for invalid and default time ranges
- integration test covering search with explicit time range and source filter

## Dependencies

- none

## Out of scope

- histogram
- saved views
- facets
- event detail drawer

## Estimated effort

2 to 3 days
