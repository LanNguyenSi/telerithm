# Task 026: Phase 3 - Query Engine Hardening, Cursors, and Async Search

## Goal

Prepare the logs explorer backend for larger datasets and heavier production use.

## Why

Offset pagination and synchronous query execution are acceptable for small datasets but degrade with scale. This phase hardens execution semantics before the product promises "production-grade" exploration broadly.

## Scope

### Backend

- introduce cursor-based pagination for `/logs/search`
- add secondary stable sort semantics
- define a query execution envelope:
  - `requestId`
  - `partial`
  - `cached`
  - `nextPageToken`
- add optional async search mode for expensive histogram/facet/pattern queries
- add configurable server limits:
  - max lookback
  - max page size
  - max synchronous runtime

### Frontend

- adapt result pagination controls to handle page tokens
- show partial-result or async-state messaging when queries are deferred
- preserve current user workflows when the backend responds with a cursor instead of a page number

## Acceptance criteria

- large searches can paginate without relying on deep offsets
- long-running exploratory queries do not block the UI indefinitely
- the result contract remains backward-compatible during rollout

## Test plan

- backend tests for cursor generation and replay
- integration tests for stable pagination under duplicated timestamps
- load test for long-running facet or pattern requests

## Dependencies

- depends on `020`
- should land after `023` if histogram/facet traffic is expected

## Out of scope

- full distributed query coordinator
- cold storage tiering

## Estimated effort

4 to 6 days
