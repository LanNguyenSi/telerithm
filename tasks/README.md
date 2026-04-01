# Tasks

## Active roadmap

### Logs Explorer hardening

| Task | Phase | Title | Status |
|------|-------|-------|--------|
| 019 | Design | Logs Explorer Production Design | Planned |
| 020 | Phase 1 | Query Foundation and Time Range | Planned |
| 021 | Phase 1 | Event Detail Drawer and Context Navigation | Planned |
| 022 | Phase 1 | Live Tail Separation and Stream Safety | Planned |
| 023 | Phase 2 | Facets, Histogram, and Field Explorer | Done |
| 024 | Phase 2 | Saved Views and Shared Searches | Done |
| 025 | Phase 3 | Patterns, Grouping, and Noise Reduction | Planned |
| 026 | Phase 3 | Query Engine Hardening, Cursors, and Async Search | Planned |
| 027 | Phase 3 | NLQ Reframing and Structured Query DSL | Planned |

## Completed

| Task | PR | Title |
|------|-----|-------|
| 005 | #14 | Frontend Polish (dark mode, empty states, error icons) |
| 007 | #10 | Registration Modes |
| 008 | #10 | Admin User Management |
| 009 | #10/#11 | Logs Pagination + Filters |
| 010 | #13 | Integration Test Coverage |
| 011 | #15/#16 | Ops UI Density + Quickfixes |

## Notes

- `019` is the design anchor for `020` through `027`.
- The phase split is intentional:
  - Phase 1 makes the existing logs page operationally safe.
  - Phase 2 adds core exploration workflows expected from production log tools.
  - Phase 3 addresses scale, noise reduction, and the long-term query model.
- `tasks/cve-018-fix-high-cves.md` remains a standalone maintenance task outside the logs roadmap.
