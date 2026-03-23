# Task 011: Ops-Optimized UI Density

**Priority:** P2
**Estimate:** 4h
**Status:** Done

## Problem

The current UI uses a consumer-SaaS aesthetic (glassmorphism, large radii, generous padding) that looks great in screenshots but is suboptimal for daily ops usage. Log analytics tools like Kibana, Datadog, and Grafana prioritize information density — users debugging a production incident at 3 AM need data, not decoration.

## Goal

Increase data density and reduce visual noise in data-heavy views while keeping the current branding aesthetic for marketing-facing surfaces (header, landing, empty states).

## Checklist

### Data Density
- [x] Log table: reduce row padding (py-4 → py-1.5), smaller font, tighter line height
- [x] Log table: monospace font for timestamp, service, host columns
- [x] Issue table: reduce row padding, tighter layout
- [x] Mobile cards: reduce padding (p-4 → p-3), smaller gaps
- [x] Reduce Card border-radius in data views (28px → 16px)
- [x] SearchPanel: more compact filter row, reduce vertical spacing

### Dark Mode as Default
- [x] Switch from `prefers-color-scheme` to class-based dark mode (`darkMode: "class"` in tailwind config)
- [x] Add dark mode toggle in header (persist to localStorage)
- [x] Default to dark when no preference is stored
- [x] Ensure all views are fully legible in dark mode

### Visual Hierarchy
- [x] Tone down header gradient blobs in app views (opacity reduced ~50%)
- [x] Reduce shadow intensity on Cards in dark mode (shadow-panel-dark)
- [x] Use subtle borders instead of shadows for panel separation in dark mode
- [x] Make log level badges more compact (px-2 py-0.5, text-[11px])

### Typography
- [x] Use monospace for all data fields (timestamps, hosts, services, event counts, API keys)
- [x] Reduce heading sizes in data views (2xl → lg, xl → lg)
- [x] Tighter tracking on data-heavy tables (tracking-[0.14em])

## Files Modified

```
frontend/tailwind.config.ts                         — darkMode: "class", shadow-panel-dark
frontend/src/app/globals.css                        — .dark class instead of prefers-color-scheme
frontend/src/app/layout.tsx                         — inline theme script for FOUC-free dark default
frontend/src/components/dashboard/theme-toggle.tsx  — NEW: dark/light toggle with localStorage
frontend/src/components/dashboard/app-shell.tsx     — theme toggle, reduced gradient, tighter header
frontend/src/components/dashboard/mobile-nav.tsx    — dark mode support
frontend/src/components/dashboard/logout-button.tsx — dark mode support
frontend/src/components/dashboard/metric-card.tsx   — smaller label, monospace value
frontend/src/components/dashboard/service-list.tsx  — compact bars, monospace service names
frontend/src/components/ui/card.tsx                 — 16px radius, dark shadow
frontend/src/components/ui/badge.tsx                — compact sizing (px-2 py-0.5)
frontend/src/components/ui/skeleton.tsx             — matching reduced radius
frontend/src/components/ui/pagination-controls.tsx  — compact controls
frontend/src/components/logs/log-table.tsx          — dense rows, monospace data
frontend/src/components/logs/search-panel.tsx       — compact filters, tighter spacing
frontend/src/components/logs/live-tail.tsx          — compact articles, monospace data
frontend/src/components/alerts/incident-list.tsx    — compact articles, monospace dates
frontend/src/app/logs/screen.tsx                    — compact execution card
frontend/src/app/issues/screen.tsx                  — dense table, monospace data
frontend/src/app/alerts/page.tsx                    — smaller headings, compact rules
frontend/src/app/alerts/subscriptions/page.tsx      — compact articles
frontend/src/app/dashboards/page.tsx                — compact summary, monospace values
frontend/src/app/settings/page.tsx                  — compact sources
frontend/src/app/admin/page.tsx                     — smaller heading
```

## Notes

- Keep the current aesthetic for first-impression surfaces (header branding, empty states, auth pages)
- The goal is NOT to clone Kibana — it's to find the right balance between "looks good in a demo" and "I can actually work with this 8 hours a day"
- Consider a density toggle (comfortable / compact) as a future enhancement
- Test with realistic log volumes (50+ rows visible) to validate density improvements
