# Task 021: Phase 1 - Event Detail Drawer and Context Navigation

## Goal

Turn each log row into an investigation entry point by adding an event detail drawer, raw payload visibility, field actions, and context navigation.

## Why

The current table only expands the message text. In production, operators need to inspect the full event, pivot on fields, and quickly navigate to related events.

## Scope

### Frontend

- add row selection for log results
- open a right-side drawer or modal with:
  - full timestamp
  - level, service, host, source
  - full message
  - raw JSON payload
  - rendered `fields` key-value list
  - copy JSON / copy message actions
  - filter-for / exclude actions on core attributes and `fields`
- add "surrounding logs" section:
  - previous N events
  - next N events
  - optional scope toggle for same service / same host / same source

### Backend

- add endpoint support for event context retrieval
  - preferred: `POST /logs/context`
  - fallback: `GET /logs/:id/context`
- define an anchor event contract
  - event ID plus team ID
  - optional scoping filters

## Files likely affected

- `frontend/src/components/logs/log-table.tsx`
- `frontend/src/app/(dashboard)/logs/screen.tsx`
- `frontend/src/lib/api/client.ts`
- `frontend/src/types/index.ts`
- `backend/src/types/domain.ts`
- `backend/src/validation/schemas.ts`
- `backend/src/api/rest/router.ts`
- `backend/src/repositories/log-repository.ts`
- `backend/src/services/query/query-service.ts`

## API contract sketch

```ts
interface LogContextRequest {
  teamId: string;
  anchorId: string;
  before: number;
  after: number;
  scope?: "global" | "service" | "host" | "source";
}
```

```ts
interface LogContextResponse {
  anchor: LogEntry;
  before: LogEntry[];
  after: LogEntry[];
}
```

## Acceptance criteria

- clicking a log row opens a detail drawer without navigating away
- the drawer shows all structured fields and raw event JSON
- users can add or exclude filters from the drawer
- users can inspect events before and after the selected log
- the table remains usable on desktop and mobile

## Test plan

- frontend interaction test for selecting a row and applying a field filter
- backend integration test for context retrieval around an anchor event
- regression test ensuring long-message expansion still works

## Dependencies

- depends on `020` for stable query state and time-bounded search context

## Out of scope

- correlation with traces or incidents beyond simple links

## Estimated effort

3 to 4 days
