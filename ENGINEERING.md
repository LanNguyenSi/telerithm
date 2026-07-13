# Engineering Standards

Unsere verbindlichen Qualitätsregeln leben in `lava-ice-logs`:

👉 https://github.com/LanNguyenSi/lava-ice-logs/blob/master/ENGINEERING.md

Das gilt für alle Arbeiten an diesem Repo — Coverage, Tests, Bug-Prozess, Definition of Done.

## Backend: team-scoping for by-id write routes

Am 2026-07-12 wurden in `backend/src/api/rest/router.ts` vier Cross-Tenant-IDORs
derselben Klasse gefunden und gefixt: eine state-changing Route mit einem
`:id`-Pfadparameter, die nur auf Authentifizierung statt auf Team-Zugehörigkeit
der geladenen Ressource prüfte. Convention seither, jetzt strukturell
erzwungen:

- Jede state-changing (POST/PUT/PATCH/DELETE) Route mit einem `:id`-artigen
  Pfadparameter muss die Team-Zugehörigkeit der Zielressource prüfen, bevor
  sie mutiert wird — nicht nur, dass der Aufrufer eingeloggt ist.
- Für Ressourcen, die per Prisma-Modell direkt (oder über eine einfache
  Relation) auf `teamId` auflösbar sind, gibt es `requireResourceTeam(...)`
  in `router.ts`: eine Factory, die "Ressource per id laden → teamId ziehen →
  404 wenn fehlt → requireTeamRole → teamId zurückgeben" kapselt. Eine neue
  Ressource anzuschließen ist eine Zeile (siehe `requireRuleTeam`,
  `requireMaintenanceWindowTeam`, `requireIncidentTeam`, `requireIssueTeam`
  in `router.ts`).
- Bewusste Ausnahmen (Ressource per-User statt per-Team gescoped,
  Admin-Routen, API-Key-Auth, Capability-Token-Routen, ...) sind erlaubt,
  müssen aber explizit begründet allowlistet werden, nicht stillschweigend
  übersprungen werden.
- Die eigentliche Durchsetzung ist `backend/tests/unit/router-team-scoping.test.ts`:
  ein Meta-Test, der `router.ts` statisch per TypeScript-AST parst, jede
  state-changing `:id`-Route findet und verlangt, dass sie entweder einen
  registrierten Team-Resolver aufruft oder einen begründeten Allowlist-Eintrag
  hat. Eine neue Route ohne Eintrag macht CI rot — die Klassifizierung selbst
  ist die Prüfung, nicht ein bestimmtes Implementierungsdetail. Mutation-
  verifiziert: ein temporärer Revert eines Team-Checks lässt den Test
  fehlschlagen.
