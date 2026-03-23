# Task 010: Integration Tests — Registration, Admin, Pagination, Filters

## Priority
P1

## Problem
PRs #10 and #11 shipped significant features without tests. DevReview flagged consistently (Testing: 2/10). Growing codebase needs a safety net.

## Scope

### From PR #10 (Registration, Admin, Pagination)

**`team-service.ts` — register()**
- `open` mode → user immediately ACTIVE + assigned to default team
- `approval` mode → user created with `status: PENDING`, not assigned to team
- `invite-only` mode → throws "Registration is currently invite-only"
- Bootstrap admin via `ADMIN_EMAIL` → role ADMIN, status ACTIVE regardless of mode

**Admin routes**
- `POST /api/v1/admin/users/:id/add-to-team` → user assigned to team with correct role
- `PATCH /api/v1/admin/users/:id/approve` → status PENDING → ACTIVE

**Pagination**
- `POST /api/v1/logs/search` with `offset` → returns correct page
- Response includes `total` count
- `offset=0 + limit=5` returns first 5, `offset=5 + limit=5` returns next 5

### From PR #11 (Filters, Sorting, Issues Pagination)

**`issue-service.ts` — list()**
- `query` filter → case-insensitive contains on title
- `service` filter → case-insensitive contains
- `sortBy: "eventCount", sortDirection: "desc"` → highest count first
- Combined: query + status + sortBy + limit + offset

**Log search filters**
- `level` filter → only returns logs of that level
- `service` filter → only returns logs of that service

## Files to Modify

- `backend/tests/integration/api.test.ts` — extend existing test suite

## Acceptance Criteria

- [ ] All registration mode behaviors tested
- [ ] Bootstrap admin tested
- [ ] Admin add-to-team tested
- [ ] Pagination offset/total tested
- [ ] Issue filter + sort tested
- [ ] Log filter tested
- [ ] All tests pass in CI

## Notes

- Tests already exist in `backend/tests/integration/api.test.ts` — just extend
- Use existing test helpers (auth setup, team creation)
- Relates to GitHub Issue #12
