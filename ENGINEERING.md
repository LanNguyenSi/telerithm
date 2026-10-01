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
  Ressource anzuschließen ist eine Zeile (siehe `requireRuleWriteTeam`,
  `requireMaintenanceWindowWriteTeam`, `requireIncidentWriteTeam`,
  `requireIssueWriteTeam` und den Lese-Resolver `requireIncidentTeam` in
  `router.ts`). Der dritte Parameter `mode` (`"read"` oder `"write"`) ist
  Pflicht; siehe den Abschnitt zur Write-Rolle unten.
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
- Der Guard deckt nur Routen ab, die die Ressourcen-id als Pfadparameter
  (`:id`) tragen. State-changing Routen, die eine Ressourcen-id stattdessen
  aus Body oder Query ziehen, fallen nicht unter diesen automatisierten
  Schutz und müssen weiterhin von Hand team-gescoped und im Review geprüft
  werden.

## Backend: VIEWER ist read-only auf team-gescopten Write-Routen

Team-Mitgliedschaft allein reicht für mutierende Routen nicht: die Rolle
`VIEWER` (`TeamRole` in `backend/prisma/schema.prisma`) ist read-only, `OWNER`,
`ADMIN` und `MEMBER` dürfen schreiben (Operator-Entscheidung 2026-10-01). Ein
`VIEWER` bekommt auf einer team-gescopten Write-Route `403 { error: "Forbidden" }`,
bevor irgendetwas mutiert wird; Lesepfade (inklusive `GET /alerts/incidents/:id/timeline`
und der lesenden POSTs `/logs/*` und `/query/natural`) bleiben für ihn offen.

- Die Regel steht an genau einer Stelle: `canWrite(role)` in `router.ts`
  (Allow-List: `OWNER`, `ADMIN`, `MEMBER` sind `true`, alles andere `false`, eine
  später ergänzte Rolle ist also erst nach bewusstem Eintrag schreibberechtigt).
  Keine Route vergleicht Rollen selbst für die Write-Entscheidung.
- Erreicht wird `canWrite` über `requireTeamWriteRole(userId, teamId, res)`
  (Mitgliedschaft über `requireTeamRole`, danach `canWrite`, sonst 403) für Routen,
  die die `teamId` aus dem Body nehmen (`POST /sources`, `POST /maintenance-windows`),
  und über Write-Resolver, die `requireResourceTeam(loader, message, "write")`
  baut, für by-id-Routen (Rule mute/unmute, Maintenance-Window löschen,
  Incident acknowledge/resolve/reopen, `PUT /issues/:id`). Ein Resolver, der eine
  mutierende Route schützt, muss im Modus `"write"` gebaut sein; lesende Routen
  nutzen `requireTeamRole` bzw. einen `"read"`-Resolver.
- Durchsetzung: `backend/tests/unit/router-write-role.test.ts` parst `router.ts`
  per TypeScript-AST und verlangt für JEDE state-changing Route (mit oder ohne
  `:param`) einen Eintrag in `ROUTE_WRITE_GUARDS`: entweder `{ kind: "write", gate }`
  (der Handler enthält einen echten `CallExpression` auf das Gate, ein Kommentar
  zählt nicht) oder einen begründeten Allowlist-Eintrag (lesender POST, per-User,
  Invites, Log-Views, Admin, Ingest, Auth, `POST /teams`). Eine neue, nicht
  klassifizierte mutierende Route macht CI rot. Der Test prüft außerdem, dass
  `requireTeamWriteRole` `canWrite` aufruft und dass jeder Write-Resolver im
  Modus `"write"` gebaut ist. Das Verhalten (VIEWER 403 und keine Mutation,
  MEMBER 2xx, Timeline für VIEWER 200) pinnen die Route-Tests in
  `backend/tests/integration/api.test.ts`.
- Nicht Teil dieser Regel: Invite-Verwaltung (`canManageInvites`, nur OWNER/ADMIN),
  Shared-Views (`canManageShared`), Subscriptions (per-User) und die
  Admin-Routen (`requireAdmin`). Ob ein `VIEWER` per `POST /logs/views` eine
  Shared-View anlegen darf, ist eine eigene offene Frage.
- Nach dem Merge prüft der Operator in Produktion, ob VIEWER-Mitgliedschaften
  existieren (`SELECT count(*) FROM "TeamMember" WHERE role = 'VIEWER'`), weil
  deren bisheriger Schreibzugriff mit dieser Regel endet.
