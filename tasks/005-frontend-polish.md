# Task 005: Frontend Polish

**Priority:** P1
**Estimate:** 3h
**Status:** Done

## Problem

Frontend needs responsive design and polish for LinkedIn screenshots and mobile demo.

## Checklist

### Responsive Design
- [x] Logs page: Search panel stacks on mobile
- [x] Dashboard: Metric cards 1-col on mobile, 2-3 col desktop
- [x] Alerts: Table → card layout on mobile
- [x] Issues: Table → card layout on mobile
- [x] Settings: Form fields full-width on mobile
- [x] Navigation: Hamburger menu or collapsible sidebar

### Visual Polish
- [x] Loading skeletons (not just "Loading...")
- [x] Empty states with helpful messages
- [x] Error boundaries with retry buttons
- [x] Consistent color palette (match OpenTriologue branding?)
- [x] Favicon + page titles

### Natural Language Search UX
- [x] Prominent search bar on logs page
- [x] AI query indicator (show "AI generating SQL..." loading)
- [x] Show generated SQL in collapsible section
- [x] Query history / saved queries

### Screenshots Prep
- [x] Dark mode (if not already)
- [x] Clean data visible in all views
- [x] At least one open incident
- [x] Natural language query result visible

## Files to Modify

```
frontend/src/app/logs/page.tsx          — Search UX
frontend/src/components/logs/*          — Responsive tables
frontend/src/components/dashboard/*     — Responsive cards
frontend/src/app/alerts/page.tsx        — Mobile layout
frontend/src/app/issues/page.tsx        — Mobile layout
frontend/src/app/layout.tsx             — Navigation responsive
```

## Notes

- Same pattern as Event Booking: hidden md:block for tables, md:hidden for cards
- Test on actual phone, not just dev tools resize
