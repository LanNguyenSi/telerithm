# Task 011: Ops-Optimized UI Density

**Priority:** P2
**Estimate:** 4h
**Status:** Open

## Problem

The current UI uses a consumer-SaaS aesthetic (glassmorphism, large radii, generous padding) that looks great in screenshots but is suboptimal for daily ops usage. Log analytics tools like Kibana, Datadog, and Grafana prioritize information density — users debugging a production incident at 3 AM need data, not decoration.

## Goal

Increase data density and reduce visual noise in data-heavy views while keeping the current branding aesthetic for marketing-facing surfaces (header, landing, empty states).

## Checklist

### Data Density
- [ ] Log table: reduce row padding (py-4 → py-2), smaller font, tighter line height
- [ ] Log table: monospace font for timestamp, service, host columns
- [ ] Issue table: reduce row padding, tighter layout
- [ ] Mobile cards: reduce padding (p-4 → p-3), smaller gaps
- [ ] Reduce Card border-radius in data views (28px → 16px or 12px)
- [ ] SearchPanel: more compact filter row, reduce vertical spacing

### Dark Mode as Default
- [ ] Switch from `prefers-color-scheme` to class-based dark mode (`darkMode: "class"` in tailwind config)
- [ ] Add dark mode toggle in header (persist to localStorage)
- [ ] Default to dark when no preference is stored
- [ ] Ensure all views are fully legible in dark mode

### Visual Hierarchy
- [ ] Tone down header gradient blobs in app views (keep for landing/marketing)
- [ ] Reduce shadow intensity on Cards in dark mode
- [ ] Use subtle borders instead of shadows for panel separation in dark mode
- [ ] Make log level badges more compact (reduce px/py)

### Typography
- [ ] Use monospace for all data fields (timestamps, hosts, services, event counts, API keys)
- [ ] Reduce heading sizes in data views (2xl → xl, xl → lg)
- [ ] Tighter tracking on data-heavy tables

## Files to Modify

```
frontend/tailwind.config.ts                    — darkMode: "class", spacing tokens
frontend/src/app/globals.css                   — dark mode class support
frontend/src/app/layout.tsx                    — dark mode class on <html>
frontend/src/components/ui/card.tsx             — reduced radii variant
frontend/src/components/ui/badge.tsx            — compact sizing
frontend/src/components/logs/log-table.tsx      — dense rows, monospace
frontend/src/components/logs/search-panel.tsx   — compact filters
frontend/src/components/dashboard/app-shell.tsx — dark mode toggle, reduced gradient
frontend/src/app/issues/screen.tsx              — dense table rows
```

## Notes

- Keep the current aesthetic for first-impression surfaces (header branding, empty states, auth pages)
- The goal is NOT to clone Kibana — it's to find the right balance between "looks good in a demo" and "I can actually work with this 8 hours a day"
- Consider a density toggle (comfortable / compact) as a future enhancement
- Test with realistic log volumes (50+ rows visible) to validate density improvements
