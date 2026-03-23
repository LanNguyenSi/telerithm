# Task 007: Registration Modes — Secure Self-Hosting

## Priority
P0 — affects any production deployment

## Problem
`MULTI_TENANT=false` auto-assigns all new registrations to the default team. Anyone who signs up sees all logs immediately.

## Solution
Add `REGISTRATION_MODE` env var with three modes:

| Mode | Behavior |
|------|----------|
| `open` | Current behavior (fine for demo) |
| `invite-only` | Registration disabled, invite-only |
| `approval` | Register → pending → admin approves |

**Default change:** `open` → `approval`

## Files to Create or Modify

- `backend/src/config/index.ts` — add `registrationMode` zod enum
- `backend/src/services/auth/team-service.ts` — branch on registrationMode in `register()`
- `backend/src/services/auth/auth-service.ts` — create user with `status: PENDING` in approval mode
- `frontend/src/app/register/page.tsx` — show "pending approval" message
- `frontend/src/app/login/page.tsx` — hide register link in invite-only mode
- `.env.production.example` — document `REGISTRATION_MODE=approval`
- `DEPLOYMENT.md` — document registration modes

## Acceptance Criteria

- [ ] `REGISTRATION_MODE=approval` — new users see "pending approval" after register
- [ ] `REGISTRATION_MODE=invite-only` — registration page not accessible
- [ ] `REGISTRATION_MODE=open` — current behavior unchanged
- [ ] Default is `approval` in production template
- [ ] Admin can approve users (see Task 008)

## Dependencies

- Task 008 (Admin View) for approval workflow UI

## Notes

- `requireAdmin` middleware already exists in backend
- `GET /api/v1/admin/users` already returns all users
- Relates to GitHub Issue #8
