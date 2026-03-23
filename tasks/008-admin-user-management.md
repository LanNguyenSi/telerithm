# Task 008: Admin View — User Management

## Priority
P1

## Problem
No way for admins to see who signed up, approve users, or assign them to teams.

## Solution
Admin page at `/admin` (ADMIN role only) with user and team management.

## Files to Create or Modify

**Backend:**
- `backend/src/api/rest/router.ts` — add `POST /api/v1/admin/users/:id/add-to-team`
- `backend/src/api/rest/router.ts` — add `DELETE /api/v1/admin/users/:id/remove-from-team/:teamId`
- `backend/src/services/team/team-service.ts` — `addUserToTeam()`, `removeUserFromTeam()`
- `backend/src/services/auth/auth-service.ts` — `approveUser()` for approval mode

**Frontend:**
- `frontend/src/app/admin/page.tsx` — NEW admin page
- `frontend/src/components/admin/UserTable.tsx` — NEW: email, name, teams, status, actions
- `frontend/src/components/admin/AddToTeamModal.tsx` — NEW: pick team + role
- `frontend/src/middleware.ts` — protect `/admin` route (ADMIN role only)

## Acceptance Criteria

- [ ] `/admin` only accessible with ADMIN role
- [ ] User table shows: email, name, joined date, teams, status
- [ ] "Add to Team" action with role selector
- [ ] Pending users (from approval mode) shown with "Approve" action
- [ ] First admin via `ADMIN_EMAIL` env var

## Dependencies

- Task 007 (Registration Modes) — pending users only exist in approval mode

## Notes

- `GET /api/v1/admin/users` and `GET /api/v1/admin/teams` already implemented
- `requireAdmin` middleware already exists
- Relates to GitHub Issue #7
