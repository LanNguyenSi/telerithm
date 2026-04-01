# Task 024: Phase 2 - Saved Views and Shared Searches

## Goal

Make useful log investigations reusable by persisting scoped explorer views.

## Why

Operational teams repeatedly return to the same searches. Without saved views, the explorer remains a one-off tool instead of a repeatable workflow surface.

## Scope

### Backend

- add CRUD support for saved log views
- define whether views are:
  - private to a user
  - shared to a team
  - both
- persist:
  - query text
  - filters
  - time range mode
  - visible columns
  - sort
  - selected facet state

### Frontend

- add a saved view picker near the query bar
- allow:
  - save current view
  - overwrite existing view
  - duplicate view
  - rename and delete view
  - mark default view
- show unsaved changes state if current URL state differs from the selected saved view

## Data model sketch

```ts
interface SavedLogView {
  id: string;
  teamId: string;
  ownerUserId?: string | null;
  name: string;
  isShared: boolean;
  isDefault: boolean;
  definition: {
    startTime?: string;
    endTime?: string;
    relativeTime?: string;
    text?: string;
    filters: LogFilter[];
    columns: string[];
    sortBy: string;
    sortDirection: "asc" | "desc";
  };
  createdAt: string;
  updatedAt: string;
}
```

## Acceptance criteria

- users can save the current explorer state and restore it later
- shared team views can be opened by other team members
- the selected view and current URL state remain consistent
- applying a saved view updates the page without manual reconstruction

## Test plan

- backend tests for CRUD and authorization
- frontend tests for save/apply/delete flows
- integration test for URL state hydration from a saved view

## Dependencies

- depends on `020`
- benefits from `023` but does not require it

## Out of scope

- dashboard widgets
- alert rule generation from saved views

## Estimated effort

3 to 4 days
