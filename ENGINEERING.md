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
- Team-gescopte mutierende Routen werden über `writeRoute(method, path,
  resolveTeam, handler)` registriert (`backend/src/api/rest/write-route.ts`,
  einmal in `router.ts` an `apiRouter` gebunden). Der Wrapper führt in fester
  Reihenfolge Authentifizierung, Team-Auflösung und Write-Gate vor dem Handler
  aus; siehe den Abschnitt zur Write-Rolle unten. Die Team-Auflösung für
  by-id-Routen baut `teamFromResource(loadTeamId, notFoundMessage)`: Ressource
  per id laden, `teamId` ziehen, 404 wenn sie fehlt. Eine neue Ressource
  anzuschließen ist eine Loader-Zeile (siehe `loadRuleTeamId`,
  `loadMaintenanceWindowTeamId`, `loadIncidentTeamId`, `loadIssueTeamId` in
  `router.ts`). Für lesende by-id-Routen bleibt `requireResourceTeam(loader,
  message)` die reine Mitgliedschaftsprüfung (Incident-Timeline).
- Bewusste Ausnahmen (Ressource per-User statt per-Team gescoped,
  Admin-Routen, API-Key-Auth, Capability-Token-Routen, ...) sind erlaubt,
  müssen aber explizit begründet allowlistet werden, nicht stillschweigend
  übersprungen werden.
- Die eigentliche Durchsetzung ist `backend/tests/unit/router-team-scoping.test.ts`:
  ein Meta-Test, der `router.ts` statisch per TypeScript-AST parst, jede
  state-changing `:id`-Route findet (`apiRouter.<method>` und `writeRoute`) und
  verlangt, dass sie entweder über `writeRoute` mit einem
  `teamFromResource(<Loader>, ...)`-Resolver registriert ist oder einen
  begründeten Allowlist-Eintrag hat. Eine neue Route ohne Eintrag macht CI rot - die Klassifizierung selbst
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
`ADMIN` und `MEMBER` dürfen schreiben. Ein
`VIEWER` bekommt auf einer team-gescopten Write-Route `403 { error: "Forbidden" }`,
bevor irgendetwas mutiert wird; Lesepfade (inklusive `GET /alerts/incidents/:id/timeline`
und der lesenden POSTs `/logs/*` und `/query/natural`) bleiben für ihn offen.

- Die Regel steht an genau einer Stelle: `canWrite(role)` in `router.ts`
  (Allow-List: `OWNER`, `ADMIN`, `MEMBER` sind `true`, alles andere `false`, eine
  später ergänzte Rolle ist also erst nach bewusstem Eintrag schreibberechtigt).
  Keine der team-gescopten Write-Routen vergleicht Rollen selbst für die
  Write-Entscheidung (die Log-View-Routen haben ein eigenes Modell, siehe unten).
- Erreicht wird `canWrite` ausschließlich über den Wrapper `writeRoute`. Er
  führt vor dem Handler aus: `requireAuth` (401), die Team-Auflösung
  (`teamFromBody(schema)` nimmt die `teamId` aus dem validierten Body, `POST
  /sources` und `POST /maintenance-windows`; `teamFromResource(loader, message,
  schema?)` nimmt das Team der per `:id` geladenen Ressource, 404 wenn sie
  fehlt, 400 bei ungültigem Body), danach `requireTeamWriteRole(userId, teamId,
  res)` (Mitgliedschaft über `requireTeamRole`, danach `canWrite`, sonst 403).
  Erst dann läuft der Handler, der `{ req, res, userId, teamId, role, input }`
  erhält. Der Handler hat keinen Weg, vor dem Gate zu laufen: die Signatur hat
  kein Middleware-Argument, der Gate-Aufruf steht im Wrapper mit festen
  Argumenten, und der Handler wird an genau einer Stelle nach dem Gate
  aufgerufen. Die neun Write-Routen (Rule mute/unmute, `POST /sources`,
  `POST /maintenance-windows`, Maintenance-Window löschen, Incident
  acknowledge/resolve/reopen, `PUT /issues/:id`) laufen darüber.
- Durchsetzung: `backend/tests/unit/router-write-role.test.ts` parst `router.ts`
  per TypeScript-AST (gemeinsamer Walker in `backend/tests/unit/router-ast.ts`)
  und verlangt für JEDE state-changing Route (mit oder ohne `:param`) einen
  Eintrag in `ROUTE_WRITE_GUARDS`: entweder `{ kind: "write" }` (die Route ist
  über `writeRoute` registriert) oder einen begründeten Allowlist-Eintrag
  (lesender POST, per-User, Invites, Log-Views, Admin, Ingest, Auth, `POST
  /teams`), registriert mit `apiRouter.<method>`. Eine neue mutierende Route
  ohne Wrapper und ohne Allowlist-Eintrag macht CI rot, ebenso eine
  Router-Registrierung, die der Test nicht klassifizieren kann (Alias von
  `apiRouter`, `apiRouter["delete"](...)`). Jeder `writeRoute`-Aufruf muss genau
  `(method, path, resolver, handler)` haben (ein weiteres Argument wäre ein
  Middleware vor dem Gate), als Top-Level-Anweisung, mit einem Resolver aus
  `teamFromBody`/`teamFromResource` (inline oder in einer Top-Level-`const`;
  eine `let`- oder `var`-Bindung ließe sich neu zuweisen), dessen Argumente einfache Bezeichner sind
  (Body-Schema aus `validation/schemas` importiert, Loader eine Top-Level-
  Konstante) plus ein String-Literal als Not-found-Meldung; lokale
  Deklarationen oder Aliase von `teamFromBody`, `teamFromResource`,
  `writeRoute` und `createWriteRoute` in `router.ts` sind verboten. Die Bindung
  `createWriteRoute({ router: apiRouter, requireAuth, requireTeamWriteRole })`
  ist festgenagelt.
  `backend/tests/unit/write-route.test.ts` belegt das Verhalten: Reihenfolge
  Auth, Resolver, Gate, Handler; ein abgelehnter Aufrufer erreicht weder den
  Handler noch dessen Default-Parameter, Tagged Templates oder `new`-Ausdrücke.
- Laufzeit-Routentabelle: `backend/tests/unit/route-table.test.ts` baut die
  echte App mit `createApp()` (gleiche Modul-Mocks wie `api.test.ts`), und zwar
  für jede Kombination der Config-Schlüssel ihrer Matrix (`nodeEnv`
  development/production/test, `multiTenant` an/aus, `trustProxy`
  gesetzt/ungesetzt; die Matrix ist handgeschrieben, eine Registrierung hinter
  einem anderen Schlüssel oder Wert, etwa `registrationMode`, den
  OpenAI-Einstellungen oder einem neuen Feature-Flag, wird erst gebaut, wenn
  der Schlüssel ergänzt ist; je ein frischer Modul-Graph per
  `vi.resetModules()`), und läuft den Express-Layer-Stack rekursiv ab,
  gemountete Router eingeschlossen. Sie
  verlangt: jede App- und Router-Middleware steht auf einer bekannten Liste
  (Name, Mount-Pfad, Arität; anonyme Layer zusätzlich mit einem Fragment ihres
  Quelltexts); weder App noch API-Router tragen einen `param`-Callback (der
  liefe vor dem Gate jeder `:id`-Route);
  außerhalb des einen API-Routers unter `/api/v1` gibt es keine mutierende
  Route; jede mutierende Route des API-Routers steht in `ROUTE_WRITE_GUARDS`
  (`backend/tests/unit/route-guards.ts`), eine "write"-Route wird von genau
  einem Handler bedient, nämlich dem, den `writeRoute` registriert und
  `write-route.ts` markiert (`isWriteRouteHandler`), eine Allowlist-Route nicht.
  Damit fallen die versehentlichen Formen von S4 zur Laufzeit auf: ein
  umbenanntes `Router`, ein Pfad als Konstante, ein zweiter Router in `app.ts`,
  ein mutierendes `app.use(...)` oder eine Registrierung, die nur unter einem
  der Config-Werte oben existiert, erscheinen als unbekannte Layer bzw.
  unklassifizierte Routen. Der statische AST-Test bleibt für das, was die
  Laufzeittabelle nicht sieht: die Form der `writeRoute`-Aufrufe und ihrer
  Resolver-Argumente, die Bindung an die echten `requireAuth` und
  `requireTeamWriteRole`, die Stelle, an der der Wrapper den Handler nach dem
  Gate aufruft, und der statische Scan über `backend/src` (`Router()` und
  `createWriteRoute` je einmal, `express()` nur in `app.ts` und
  `config/index.ts`, keine Registrierung außerhalb von `router.ts`): er liest
  auch Code außerhalb von `createApp()`, etwa `server.ts`, erkennt dort aber
  nur die aufgezählten Schreibweisen (Pfad als String- oder Template-Literal,
  Mount per Bezeichner, der Name `apiRouter`); ein Pfad in einer Konstante oder
  einem Array wird dort nicht erkannt.
- Bedrohungsmodell: Wrapper und Meta-Tests richten sich gegen versehentliche
  Lücken, also eine Route, die jemand ohne Wrapper oder mit Arbeit vor dem Gate
  anlegt oder verschiebt. Bewusst verschleierte Registrierungen sind ein
  Review-Punkt, kein Versprechen der Tests: Aliase oder Indexzugriffe auf den
  Router außerhalb der erkannten Formen, Registrierungen erst zur Request-Zeit
  (`req.app`) oder nur unter Config-Werten außerhalb der Matrix, ein ersetzter
  bekannter Layer, der Name und Quelltext-Fragment beibehält, neues Verhalten
  in einer bekannten Middleware (etwa ein `verify`-Callback von
  `express.json`) und ein zur Laufzeit gepatchtes importiertes Schema.
- Die früheren Sonderformen sind damit beantwortet: Seiteneffekte in den
  Gate-Argumenten (S0) lassen sich nicht schreiben, ein Middleware-Argument vor
  dem Handler (S1) lehnt die Formprüfung ab, Default-Parameter und Tagged
  Templates (S2, S3) laufen im Handler nach dem Gate, eine zweite Router-
  Instanz oder eine Registrierung aus einem anderen Modul (S4) findet die
  Laufzeittabelle, soweit sie nicht bewusst verschleiert ist (siehe
  Bedrohungsmodell). Zwei Eingaben laufen vor dem Gate, weil das Gate das Team
  braucht, das sie liefern, und der Wrapper sie nicht kapseln kann: der Loader
  von `teamFromResource` und das Body-Schema (samt `transform`, `refine` und
  `preprocess`) von `teamFromBody`/`teamFromResource`. Beide müssen frei von
  Seiteneffekten sein. Der Test erzwingt nur, dass sie benannt sind (Schema aus
  `validation/schemas`, Loader als Top-Level-Konstante) und nicht inline neben
  der Route stehen; was die benannte Funktion tut, ist ein Review-Punkt, den der
  Test nicht inspiziert. Der Test prüft
  außerdem, dass `requireTeamWriteRole` `canWrite` aufruft und dass
  `requireResourceTeam` nur die Mitgliedschaft prüft. Das Verhalten (VIEWER 403
  und keine Mutation, MEMBER 2xx, Timeline für VIEWER 200) pinnen die
  Route-Tests in `backend/tests/integration/api.test.ts`.
- Nicht Teil dieser Regel: Invite-Verwaltung (`canManageInvites`, nur OWNER/ADMIN),
  Subscriptions (per-User) und die Admin-Routen (`requireAdmin`). Die
  Log-View-Routen (`/logs/views`) liegen ebenfalls außerhalb und sind für
  `VIEWER` nicht read-only: private Views (per-User-Zustand) darf jedes
  Mitglied anlegen und ändern. Team-weiter Zustand ist dagegen nur für
  OWNER/ADMIN (`canManageShared`): `POST` und `PUT` antworten mit 403, bevor
  der Service läuft, wenn `isShared: true` oder `isDefault: true` gesetzt
  wird (`isDefault: true` löscht das Default-Flag aller Shared-Views des
  Teams). `canManageShared` greift außerdem beim Ändern oder Löschen fremder
  Shared-Views. `POST /logs/views/:id/duplicate` prüft `canRead`
  (Shared-View oder eigene) und übernimmt `isShared` nur, wenn
  `canManageShared` gilt (agent-tasks `765bb823`). `isDefault: true` ist für
  Nicht-Admins auch auf einer privaten View gesperrt, weil der Service das
  Default-Flag teamweit zurücksetzt. Offene Lücke: ein Nicht-Admin, der eine
  bereits geteilte oder als Default markierte View besitzt (vor dieser
  Änderung angelegt, oder nach einer Herabstufung vom Admin), kann sie weiter
  ändern, auf privat zurückstellen und löschen; bestehende Daten werden nicht
  migriert.
- Nach dem Merge prüft der Operator in Produktion, ob VIEWER-Mitgliedschaften
  existieren (`SELECT count(*) FROM "TeamMember" WHERE role = 'VIEWER'`), weil
  deren bisheriger Schreibzugriff mit dieser Regel endet.
