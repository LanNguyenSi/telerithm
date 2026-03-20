# Task 005: Frontend Polish

**Priority:** P1
**Estimate:** 3h
**Status:** Open

## Problem

Frontend needs responsive design and polish for LinkedIn screenshots and mobile demo.

## Checklist

### Responsive Design
- [ ] Logs page: Search panel stacks on mobile
- [ ] Dashboard: Metric cards 1-col on mobile, 2-3 col desktop
- [ ] Alerts: Table → card layout on mobile
- [ ] Issues: Table → card layout on mobile
- [ ] Settings: Form fields full-width on mobile
- [ ] Navigation: Hamburger menu or collapsible sidebar

### Visual Polish
- [ ] Loading skeletons (not just "Loading...")
- [ ] Empty states with helpful messages
- [ ] Error boundaries with retry buttons
- [ ] Consistent color palette (match OpenTriologue branding?)
- [ ] Favicon + page titles

### Natural Language Search UX
- [ ] Prominent search bar on logs page
- [ ] AI query indicator (show "AI generating SQL..." loading)
- [ ] Show generated SQL in collapsible section
- [ ] Query history / saved queries

### Screenshots Prep
- [ ] Dark mode (if not already)
- [ ] Clean data visible in all views
- [ ] At least one open incident
- [ ] Natural language query result visible

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
