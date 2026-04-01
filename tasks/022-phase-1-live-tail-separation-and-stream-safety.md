# Task 022: Phase 1 - Live Tail Separation and Stream Safety

## Goal

Separate live streaming from historical search so operators can trust both views.

## Why

The current logs screen prepends streamed events into the active result list regardless of the query, filters, pagination, or time range. That is acceptable for a demo but misleading in production.

## Scope

### Frontend

- remove the implicit mutation of historical search results from `LogExplorer`
- move live streaming into an explicit mode or dedicated panel
- add controls for:
  - start / pause
  - clear stream
  - scoped stream query
  - connection status
- display stream limits and sampling state when applicable

### Backend

- extend `GET /stream/logs` to accept a constrained filter scope
  - teamId
  - sourceId
  - level
  - service
  - host
  - optional text match if feasible
- define server behavior under high throughput
  - sample uniformly or cap the outgoing rate
  - expose a metadata event when sampling is active

## Files likely affected

- `frontend/src/app/(dashboard)/logs/screen.tsx`
- `frontend/src/components/logs/live-tail.tsx`
- `frontend/src/lib/api/client.ts`
- `backend/src/api/rest/router.ts`
- `backend/src/services/streaming/streaming-service.ts`
- `backend/src/types/domain.ts`

## Acceptance criteria

- historical search results do not change when new stream events arrive
- Live Tail can be paused and resumed without leaving the page
- stream filters are visible to the user
- the UI communicates when the stream is sampled, capped, or disconnected

## Test plan

- frontend test ensuring SSE updates do not mutate paginated search results
- backend test for stream subscription filtering
- manual load test for capped or sampled stream behavior

## Dependencies

- can proceed in parallel with `021`
- should land after or with `020`

## Out of scope

- persistent stream replay
- websocket migration

## Estimated effort

2 to 3 days
