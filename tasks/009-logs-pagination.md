# Task 009: Pagination for Logs Page

## Priority
P1

## Problem
Logs page shows fixed results with no way to browse older logs.

## Solution
Add pagination controls below the log table.

## UX

```
[← Previous]  Page 2 of 14  [Next →]   Rows: [25 ▾]
```

## Files to Create or Modify

**Backend:**
- `backend/src/repositories/log-repository.ts` — return `total` count in search result (may already exist)
- `backend/src/types/domain.ts` — verify `total` field in `LogSearchResult`

**Frontend:**
- `frontend/src/app/logs/page.tsx` — add pagination state + URL search params
- `frontend/src/components/logs/log-table.tsx` — accept page props, show pagination controls
- `frontend/src/components/logs/search-panel.tsx` — pass page size to search

## Acceptance Criteria

- [ ] Previous/Next buttons below log table
- [ ] Page indicator: "Page X of Y"
- [ ] Page size selector: 25 / 50 / 100
- [ ] Current filters preserved when navigating pages
- [ ] Page state in URL (browser back/forward works)
- [ ] Default page size: 50

## Notes

- `POST /api/v1/logs/search` already supports `limit` + `offset`
- Check if `LogSearchResult` already has `total` field before adding
- Relates to GitHub Issue #9
