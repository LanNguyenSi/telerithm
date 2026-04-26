# Changelog — Telerithm app suite

All notable changes to the Telerithm backend + frontend are
documented in this file. The SDK has its own changelog under
[`packages/sdk-js/CHANGELOG.md`](./packages/sdk-js/CHANGELOG.md).

The format is based on [Keep a Changelog](https://keepachangelog.com/),
and this project adheres to [Semantic Versioning](https://semver.org/).
App-suite releases are tagged on the parent repo as `vX.Y.Z`.

> **Note**: The backend and frontend are not published as npm
> packages — they are private apps deployed via deploy-panel from
> `master`. App-suite tags are deploy provenance, not consumable
> artefacts.

## [0.1.0] - 2026-04-26

First tagged release of the Telerithm app suite.

This is a baseline tag covering the platform as it stands at the
time of cut. Subsequent app-suite releases will list the user-visible
deltas under their own `[X.Y.Z]` heading.

### Highlights at v0.1.0

#### NLQ (natural-language query) pipeline

- **AI hardening** (PR #52): retry, timeout, Zod validation on AI
  output, per-stage metrics. Graceful fallback on validation failures.
- **Search mode separation** (PR #43, task-028): explicit modes for
  AI-assisted vs. raw text search; UI toggle in the search bar.
- **Domain stopword filtering** (PR #41, task-029): operator-defined
  stopwords stripped from NLQ before AI extraction.
- **Term recovery into text search** (PR #40): NL terms pruned by
  the structured-filter pass are still routed to text search instead
  of being dropped.
- **Filter coverage fixes** (PRs #44, #45): textTerms covered by
  AI-extracted filters are stripped to avoid double-matching;
  fully-deduped queries no longer fall back to raw NL search.
- **Payment-failures recall fix** (PR #38).

#### Logs UI

- **Relative time-range UX** + **semantic URL state** (PR #39):
  shareable URLs encode the relative range ("last 24h") rather than
  baking absolute timestamps.
- **Phase-2 time URL sharing toggle** (PR #42).

#### Quality + ops

- **Test coverage gates** (task-030, PRs around it): backend 80%
  / frontend 70% enforced in CI. Coverage rose backend 53% → 92%
  and frontend 47% → 86% across the gate-prep PRs.
- **deploy-panel integration** (PR #50): `.relay.yml` registers the
  app suite with the deploy-panel pipeline. Production at
  `logs.opentriologue.ai`.
- **Engineering docs** (`ENGINEERING.md`): Quality standards,
  reviewed by Ice + Lava agents.
- **Local LLM support** documented (`LOCAL_LLM.md`).
- **Self-hostable** (Docker Compose with `docker-compose.prod.yml`
  + `docker-compose.traefik.yml`).

### Security

- `next` bumped to 15.5.15 (frontend) — GHSA-q4gf-8mx6-v5v3 (PR #51).
- `vite` bumped in backend + frontend to patch high-severity
  CVEs (PR #49).
- Generic dependency CVE rounds (PR #48).

### Deployment

- Production: deployed via deploy-panel from `master`, no tag
  needed for the deploy itself. This `v0.1.0` tag marks the
  baseline for future deploy-provenance discussions.
- Self-host: see `docker-compose.prod.yml` + `DEPLOYMENT.md`.
