# Task 030 — Test Coverage: Backend ≥ 80%, Frontend ≥ 70%

## Status: OPEN
## Assigned: Lava 🌋 (Backend Unit Tests) + Ice 🧊 (Integration Tests + Frontend)
## Priority: HIGH — CI-Gate blockiert alle PRs

---

## Ziel

CI-Gate eingeführt in `.github/workflows/ci.yml`:
- **Backend:** ≥ 80% Lines/Statements/Functions/Branches
- **Frontend:** ≥ 70% Lines/Statements

Aktuell schlägt CI fehl. Tests müssen geschrieben werden bis Threshold erreicht ist.

---

## Scope

### Backend — Fehlende Tests (Lava)

Kritische Services ohne oder mit unzureichender Coverage:

**`src/services/query/query-service.ts`**
- `searchManual` — direkte Repo-Weiterleitung
- `getContext`, `getFacets`, `getHistogram`, `getPatterns`
- `startAsyncJob`, `getAsyncJob`, `cleanupAsyncJobs`
- Dashboard-Methoden

**`src/services/ai/ai-service.ts`**
- `translateQueryWithHeuristics` — alle Branches
- TERM_VARIANTS Expansion
- formContext Injection in LLM Prompt

**`src/repositories/log-repository.ts`**
- `buildScopedWhere` — alle Filter-Kombinationen
- `buildSearchCondition` — Term-Expansion, Sonderzeichen
- `getContext`, `getFacets`, `getHistogram`, `getPatterns`

**`src/services/streaming/streaming-service.ts`**
- Happy Path + Error Cases

**`src/api/rest/router.ts`**
- Fehlende Route-Tests (Auth, Sources, Log-Views)

### Frontend — Fehlende Tests (Ice)

**`src/hooks/use-log-search.ts`**
- URL-Parameter Parsing (alle Modi)
- `updateSearch` — alle Felder
- `shareAbsoluteTime` — sessionStorage read/write

**`src/lib/api/client.ts`**
- `getLogs` — natural vs. manual mode
- Context-Übergabe

---

## Regeln (per ENGINEERING.md)

- Tests schreiben **bevor** weitere Features
- Regression Tests für alle bisherigen Bugs (NLQ-Dedup, textTerms-Fallback, etc.)
- Kein Mock-Inflation: echte Logik testen, nicht nur Mocks bestätigen

---

## Definition of Done

- [ ] `npm run test:coverage` lokal ≥ 80% Backend
- [ ] `npx vitest run --coverage` lokal ≥ 70% Frontend
- [ ] CI grün (Coverage-Gate passing)
- [ ] PR reviewed von Ice (Backend) / Lava (Frontend)

---

## How to measure current coverage

```bash
# Backend (auf Stone's VPS oder lokal)
cd backend && npm ci && npm run test:coverage

# Frontend
cd frontend && npm ci --legacy-peer-deps && npx vitest run --coverage
```
