# ENGINEERING.md — Telerithm Quality Standards

> Verbindliche Regeln für Ice 🧊 und Lava 🌋. Kein Feature, kein Fix ohne diese Leitplanken.

---

## 1. Tests — Mindeststandard

### Coverage
- **Backend:** ≥ 80% Code Coverage — CI-Gate (Build schlägt fehl wenn darunter)
- **Frontend:** ≥ 70% für kritische Logik (hooks, utils, API-client) — CI-Gate
- Coverage-Report: `npm run test:coverage` (Backend + Frontend)

### Wo Tests zwingend sind
- Jede neue Service-Methode (QueryService, AIService, etc.) → Unit Test
- Jede Bug-Fix → Regression Test **bevor** der Fix geschrieben wird
- Jede API-Route → mindestens Happy Path + Error Case

### TDD — wann es gilt
Bei **neuen Features mit klarer Spec:** Test zuerst, dann Implementation.
- Schritt 1: Test schreiben (failing)
- Schritt 2: Minimal-Implementation (passing)
- Schritt 3: Refactor + Review

Bei **Bug-Fixes:** immer Regression Test zuerst — der den Bug reproduziert — dann Fix.

---

## 2. E2E Tests

### Setup
- Framework: **Playwright**
- Ziel: kritische User-Flows (Login, Log-Search, NLQ, Saved Views)
- Läuft **nicht** in CI-Pflicht — zu langsam/flaky für jeden PR

### Ausführung
```bash
make e2e              # Full E2E Suite lokal
make e2e TEST=search  # Einzelner Test
```

### Wann ausführen
- Vor jedem Release / Deployment auf Staging
- Nach größeren Refactorings (z.B. NLQ-Architektur-Änderungen)
- Bei Bugs die User-Flows betreffen

---

## 3. Bug-Handling — Professioneller Prozess

### ⛔ Verboten
- Quick-and-dirty Fixes ohne Root Cause
- Patches ohne Verification ("sollte klappen")
- Mehrere Fixes in Serie ohne je den vorherigen bestätigt zu haben

### Pflicht-Prozess

**Schritt 1: Issue anlegen**
GitHub Issue mit diesem Template:
```
## Observed Behavior
Was passiert tatsächlich?

## Expected Behavior
Was sollte passieren?

## Steps to Reproduce
1. ...
2. ...
3. ...

## Minimal Reproduce Case
(curl-Befehl, Test, Screenshot)

## Hypothese
Warum passiert das? (nur wenn gesichert)

## Root Cause
(erst ausfüllen wenn bewiesen)
```

**Schritt 2: Reproduce**
Vor jedem Fix: einen Curl-Befehl oder Test der den Bug **beweisbar zeigt**.
Kein Fix ohne Reproduce.

**Schritt 3: Stack-Trace — von oben nach unten**
Bei Full-Stack-Bugs immer in dieser Reihenfolge:
```
Browser DevTools (Network Tab)
  → Request-Body exakt prüfen
  → Backend API-Log
  → Service-Layer (was bekommt der Service?)
  → Repository/Query (was geht in die DB?)
  → DB-Ergebnis (direkte DB-Query)
```
Nie rückwärts. Nie Schichten überspringen.

**Schritt 4: Fix + Regression Test**
- Test schreiben der den Bug reproduziert (failing)
- Fix implementieren
- Test wird grün
- Bestehende Tests bleiben grün

**Schritt 5: Verify**
Nach Deploy: Reproduce-Case erneut ausführen — diesmal gegen Staging.
Erst dann: Issue schließen.

### Stopregel
> Wenn zwei aufeinanderfolgende Fixes nicht geholfen haben → **Stopp**.
> Lage neu bewerten. Issue kommentieren. Ggf. Lan fragen.

---

## 4. Code Review Standards

### Deleted Lines
Deleted lines genauso kritisch lesen wie Added lines.
Bei Refactorings: Was wurde entfernt? Warum war es da? Ist das Absicht?

### Regression Risk
Bei jedem PR explizit prüfen:
- Welche bestehenden Behaviors könnte das brechen?
- Gibt es Tests die das abdecken?

### Coverage-Delta
PRs die Coverage signifikant senken (>5%) → Kommentar erforderlich + Tests nachliefern.

---

## 5. Definition of Done

Ein Feature/Fix ist **Done** wenn:
- [ ] Tests geschrieben und grün (inkl. Regression Tests bei Bugs)
- [ ] Coverage ≥ Mindeststandard
- [ ] PR reviewed (Ice reviewed Lava, Lava reviewed Ice bei Cross-Reviews)
- [ ] CI grün (inkl. Format-Check, Lint, Tests)
- [ ] Nach Deploy: Smoke-Test ausgeführt und bestätigt
- [ ] Issue/Task geschlossen

---

## 6. Commit-Hygiene

Format: `type(scope): beschreibung`

Types: `feat`, `fix`, `test`, `refactor`, `style`, `docs`, `chore`

**Bei Fixes:** Commit-Message erklärt Root Cause, nicht nur Symptom.
```
❌ fix(nlq): fix search returning 0 results
✅ fix(nlq): do not fall back to raw NL query when textTerms are all deduped
   
   When AI filters cover all textTerms, textTerms becomes empty.
   Falling back to query.query triggers heuristic parsing of the full
   NL phrase, generating tokens not present in log messages → 0 results.
```

---

*Dieses Dokument gilt für Ice 🧊 und Lava 🌋 gleichermaßen.*
*Updates: PR mit Begründung + Review durch beide.*
