import { describe, expect, it } from "vitest";
import ts from "typescript";
import {
  STATE_CHANGING_METHODS,
  extractRoutes,
  findResolverFactoryCall,
  findUnrecognizedApiRouterUsages,
  loadRouterSourceFile,
  routeKey,
  routeSatisfiesVerify,
  type RouteDecl,
  type Verify,
} from "./router-ast.js";

// Structural guard for the by-id-write-route team-scoping convention (see
// `teamFromResource` in write-route.ts and `requireResourceTeam` in router.ts,
// and ENGINEERING.md).
//
// On 2026-07-12 four cross-tenant IDORs were found and fixed in
// backend/src/api/rest/router.ts, all the same shape: a state-changing route
// with an `:id`-style path parameter that authorized on plain authentication
// instead of resolving the target resource's team first. The reviewer's
// finding was that "the gate is applied per-route by convention with no
// structural enforcement, so a fourth omission is likely as routes are
// added" (agent-tasks 0e7d0d74).
//
// This test statically parses router.ts's source text via the TypeScript
// compiler API (it never *imports* router.ts — importing it would construct
// live Prisma/ClickHouse/Redis-backed services as a side effect of module
// load) and enumerates every state-changing (POST/PUT/PATCH/DELETE) route
// whose path has a `:param`. Every such route MUST have an entry in
// ROUTE_TEAM_GUARDS below: either `{ kind: "resolver" }`, naming the loader
// of the teamFromResource resolver the route is registered with (writeRoute
// then authorizes the loaded resource's team), or `{ kind: "allowlist" }`, an
// explicit, justified exception.
//
// Two independent things make this a *structural* guard rather than a
// convention:
//   1. "every route is classified": a route present in router.ts but absent
//      from ROUTE_TEAM_GUARDS fails CI immediately, so a newly added by-id
//      write route cannot go unreviewed for team-scoping.
//   2. "no unrecognized apiRouter registration shape": a route registered in
//      a way extractRoutes below does not understand (e.g. `.route()`
//      chaining, `.use()` sub-router mounts, a non-literal path) fails CI
//      loudly instead of silently escaping extraction and (1)'s check.
//
// Per-route verification walks the actual AST for a real CallExpression (or
// Identifier reference) rather than substring-searching the handler's raw
// source text. A raw substring search would also match the expected name
// appearing only in a comment (a prior version of this test had exactly that
// false-negative; see the "comment-only mentions" regression tests below,
// which pin the fix).
// "resolver": the route is registered through writeRoute with a
// teamFromResource(<loaderName>, ...) team resolver (inline, or via a top-level
// const), i.e. the team is derived from the loaded resource, not from the
// request. "allowlist": an explicit, justified exception.
type Guard =
  | { kind: "resolver"; loaderName: string }
  | { kind: "allowlist"; reason: string; verify?: Verify };

// Every state-changing route in router.ts whose path contains a `:param`,
// keyed by "METHOD /path" exactly as declared there.
const ROUTE_TEAM_GUARDS: Record<string, Guard> = {
  // --- Resource-derived team resolvers, built via teamFromResource ---
  "POST /alerts/rules/:id/mute": { kind: "resolver", loaderName: "loadRuleTeamId" },
  "POST /alerts/rules/:id/unmute": { kind: "resolver", loaderName: "loadRuleTeamId" },
  "DELETE /maintenance-windows/:id": { kind: "resolver", loaderName: "loadMaintenanceWindowTeamId" },
  "POST /alerts/incidents/:id/acknowledge": { kind: "resolver", loaderName: "loadIncidentTeamId" },
  "POST /alerts/incidents/:id/resolve": { kind: "resolver", loaderName: "loadIncidentTeamId" },
  "POST /alerts/incidents/:id/reopen": { kind: "resolver", loaderName: "loadIncidentTeamId" },
  "PUT /issues/:id": { kind: "resolver", loaderName: "loadIssueTeamId" },

  // --- Explicit, justified allowlist (never a silent skip) ---
  "POST /ingest/:sourceId": {
    kind: "allowlist",
    reason:
      "authenticateApiKey resolves and pins a single source/tenant from the API key; there is no user/team " +
      "session to scope, and the middleware itself rejects a key that does not match the URL's :sourceId " +
      "(cross-tenant log forgery).",
    verify: { type: "identifier", name: "authenticateApiKey" },
  },
  "POST /ingest/:sourceId/raw": {
    kind: "allowlist",
    reason: "Same API-key boundary as POST /ingest/:sourceId.",
    verify: { type: "identifier", name: "authenticateApiKey" },
  },
  "PUT /logs/views/:id": {
    kind: "allowlist",
    reason:
      "teamId comes from the request (query/body) and is membership-checked via requireTeamRole; " +
      "LogViewService.update then scopes the mutation by the compound (id, teamId) match and throws " +
      "NotFoundError on mismatch (see log-view-service.ts), so a foreign id paired with the caller's own " +
      "teamId 404s instead of mutating another team's view.",
    verify: { type: "call", callee: "requireTeamRole" },
  },
  "POST /logs/views/:id/duplicate": {
    kind: "allowlist",
    reason: "Same compound (id, teamId) service-layer scoping as PUT /logs/views/:id.",
    verify: { type: "call", callee: "requireTeamRole" },
  },
  "DELETE /logs/views/:id": {
    kind: "allowlist",
    reason: "Same compound (id, teamId) service-layer scoping as PUT /logs/views/:id.",
    verify: { type: "call", callee: "requireTeamRole" },
  },
  "PUT /subscriptions/:id": {
    kind: "allowlist",
    reason:
      "Subscriptions are scoped per-user, not per-team: SubscriptionService.update writes with " +
      "`where: { id, userId }`, so a foreign id paired with the caller's own userId matches nothing.",
    verify: { type: "call", callee: "subscriptionService.update", alsoReferences: "userId" },
  },
  "DELETE /subscriptions/:id": {
    kind: "allowlist",
    reason: "Same per-user (id, userId) scoping as PUT /subscriptions/:id.",
    verify: { type: "call", callee: "subscriptionService.delete", alsoReferences: "userId" },
  },
  "POST /subscriptions/:id/test": {
    kind: "allowlist",
    reason:
      "Loads the subscription with `where: { id, userId }`; same per-user scoping as the other subscription " +
      "routes.",
    verify: { type: "call", callee: "prisma.alertSubscription.findFirst", alsoReferences: "userId" },
  },
  "POST /teams/:id/invites": {
    kind: "allowlist",
    reason:
      "The :id path parameter IS the team being operated on, not a separate resource that needs resolving to " +
      "a team; requireTeamRole is called directly against it, and canManageInvites further restricts to " +
      "OWNER/ADMIN.",
    verify: { type: "call", callee: "requireTeamRole", alsoReferences: "teamId" },
  },
  "POST /invites/:token/accept": {
    kind: "allowlist",
    reason:
      "Authorization is the unforgeable, single-use, expiring invite token itself (ULID-based, see " +
      "TeamService.createInvite), a capability-token pattern like a password-reset link, not a " +
      "team-membership check — the accepting user is not yet a team member.",
  },
  "DELETE /invites/:id": {
    kind: "allowlist",
    reason:
      "Loads the invite by id and derives its team inline (the same resource-derived pattern as " +
      "requireResourceTeam), but also requires canManageInvites (OWNER/ADMIN) on top of plain membership, " +
      "which requireResourceTeam does not model. Kept inline rather than forcing an awkward fit onto the " +
      "shared factory.",
    verify: { type: "call", callee: "requireTeamRole", alsoReferences: "invite" },
  },
  "PUT /admin/users/:id": {
    kind: "allowlist",
    reason: "requireAdmin gates on global admin role, which supersedes team scoping by design.",
    verify: { type: "call", callee: "requireAdmin" },
  },
  "POST /admin/users/:id/approve": {
    kind: "allowlist",
    reason: "Same requireAdmin global-admin gate as PUT /admin/users/:id.",
    verify: { type: "call", callee: "requireAdmin" },
  },
  "POST /admin/users/:id/add-to-team": {
    kind: "allowlist",
    reason: "Same requireAdmin global-admin gate as PUT /admin/users/:id.",
    verify: { type: "call", callee: "requireAdmin" },
  },
  "DELETE /admin/users/:id/remove-from-team/:teamId": {
    kind: "allowlist",
    reason: "Same requireAdmin global-admin gate as PUT /admin/users/:id.",
    verify: { type: "call", callee: "requireAdmin" },
  },
  "DELETE /admin/teams/:id/members/:userId": {
    kind: "allowlist",
    reason: "Same requireAdmin global-admin gate as PUT /admin/users/:id.",
    verify: { type: "call", callee: "requireAdmin" },
  },
};

// True when the route's team resolver is `teamFromResource(<loaderName>, ...)`.
// The factory call is found as an AST node, so a comment mentioning the name
// cannot satisfy it.
function routeResolvesTeamFrom(route: RouteDecl, sourceFile: ts.SourceFile, loaderName: string): boolean {
  const call = findResolverFactoryCall(route, sourceFile);
  if (!call || !ts.isIdentifier(call.expression) || call.expression.text !== "teamFromResource") return false;
  const [loader] = call.arguments;
  return loader !== undefined && ts.isIdentifier(loader) && loader.text === loaderName;
}

const routerSourceFile = loadRouterSourceFile();
const allRoutes = extractRoutes(routerSourceFile);
const writeIdRoutes = allRoutes.filter(
  (r) => STATE_CHANGING_METHODS.has(r.method) && /:[A-Za-z0-9_]+/.test(r.routePath),
);

describe("router.ts: by-id write routes must declare a team-scoping guard", () => {
  it("found at least one state-changing by-id route (sanity check the AST walk isn't silently empty)", () => {
    expect(writeIdRoutes.length).toBeGreaterThan(0);
  });

  it("router.ts has no apiRouter registration shape the AST walker cannot classify", () => {
    const issues = findUnrecognizedApiRouterUsages(routerSourceFile);
    expect(
      issues,
      "Found apiRouter usage(s) the team-scoping guard's walker does not understand, so they would silently " +
        "escape classification below. See each issue's reason for what to extend.",
    ).toEqual([]);
  });

  it("every state-changing by-id route is classified in ROUTE_TEAM_GUARDS", () => {
    const actual = new Set(writeIdRoutes.map(routeKey));
    const registered = new Set(Object.keys(ROUTE_TEAM_GUARDS));

    const unclassified = [...actual].filter((key) => !registered.has(key));
    const stale = [...registered].filter((key) => !actual.has(key));

    expect(
      unclassified,
      "New state-changing by-id route(s) added to router.ts with no team-scoping classification. Add an " +
        'entry to ROUTE_TEAM_GUARDS in this test: either { kind: "resolver" } naming the loader the route\'s ' +
        'teamFromResource resolver must use, or a justified { kind: "allowlist" }.',
    ).toEqual([]);
    expect(
      stale,
      "ROUTE_TEAM_GUARDS has entries for routes no longer present in router.ts. Remove the stale entries.",
    ).toEqual([]);
  });

  for (const route of writeIdRoutes) {
    const key = routeKey(route);
    const guard = ROUTE_TEAM_GUARDS[key];

    it(`${key} enforces its declared guard`, () => {
      if (!guard) {
        // Already reported by "every route is classified" above; skip here
        // instead of producing a second, confusing failure for the same gap.
        return;
      }
      if (guard.kind === "resolver") {
        expect(
          route.via,
          `Expected ${key} to be registered through writeRoute (write gate applied before the handler).`,
        ).toBe("writeRoute");
        expect(
          routeResolvesTeamFrom(route, routerSourceFile, guard.loaderName),
          `Expected ${key} to resolve its team with teamFromResource(${guard.loaderName}, ...) so the resource's ` +
            "owning team is authorized (a mention in a comment does not count).",
        ).toBe(true);
      } else if (guard.verify) {
        expect(
          routeSatisfiesVerify(route, routerSourceFile, guard.verify),
          `Expected ${key} (allowlisted: ${guard.reason}) to still satisfy its declared guard evidence ` +
            `(${JSON.stringify(guard.verify)}); a mention in a comment does not count.`,
        ).toBe(true);
      }
    });
  }

  it("every allowlist entry carries a substantive justification", () => {
    for (const [key, guard] of Object.entries(ROUTE_TEAM_GUARDS)) {
      if (guard.kind === "allowlist") {
        expect(
          guard.reason.length,
          `Allowlist entry for ${key} needs a real justification, not a stub.`,
        ).toBeGreaterThan(20);
      }
    }
  });

  // Regression tests for the false-negative this test used to have: an
  // earlier version checked `handlerText.includes(resolverName + "(")` over
  // the raw source text of the whole handler, which also matches the
  // resolver name appearing only in a comment. Matching real AST nodes
  // (findResolverFactoryCall/routeResolvesTeamFrom above) fixes that; these
  // tests pin the fix against regressing back to a substring check.
  describe("comment-only mentions do not satisfy a guard", () => {
    it("a loader mentioned only in a comment is NOT detected (negative control)", () => {
      const synthetic = `
        writeRoute(
          "delete",
          "/widgets/:id",
          teamFromResource(loadOtherTeamId, "Widget not found"),
          async ({ req, res }) => {
            // loadWidgetTeamId used to be the loader here; a naive substring
            // check over the handler's source text would still "see" it.
            res.status(204).end();
          },
        );
      `;
      const syntheticFile = ts.createSourceFile("synthetic.ts", synthetic, ts.ScriptTarget.Latest, true);
      const [route] = extractRoutes(syntheticFile);
      expect(route).toBeDefined();
      expect(routeResolvesTeamFrom(route, syntheticFile, "loadWidgetTeamId")).toBe(false);
    });

    it("an inline teamFromResource(loader, ...) IS detected (positive control)", () => {
      const synthetic = `
        writeRoute(
          "delete",
          "/widgets/:id",
          teamFromResource(loadWidgetTeamId, "Widget not found"),
          async ({ res }) => {
            res.status(204).end();
          },
        );
      `;
      const syntheticFile = ts.createSourceFile("synthetic.ts", synthetic, ts.ScriptTarget.Latest, true);
      const [route] = extractRoutes(syntheticFile);
      expect(routeResolvesTeamFrom(route, syntheticFile, "loadWidgetTeamId")).toBe(true);
    });

    it("a resolver held in a top-level const IS detected (positive control)", () => {
      const synthetic = `
        const widgetTeam = teamFromResource(loadWidgetTeamId, "Widget not found");
        writeRoute("delete", "/widgets/:id", widgetTeam, async ({ res }) => {
          res.status(204).end();
        });
      `;
      const syntheticFile = ts.createSourceFile("synthetic.ts", synthetic, ts.ScriptTarget.Latest, true);
      const [route] = extractRoutes(syntheticFile);
      expect(routeResolvesTeamFrom(route, syntheticFile, "loadWidgetTeamId")).toBe(true);
    });

    it("a handler that only calls the loader itself is NOT a resolver (negative control)", () => {
      const synthetic = `
        writeRoute("delete", "/widgets/:id", teamFromBody(widgetSchema), async ({ res }) => {
          await loadWidgetTeamId("x");
          res.status(204).end();
        });
      `;
      const syntheticFile = ts.createSourceFile("synthetic.ts", synthetic, ts.ScriptTarget.Latest, true);
      const [route] = extractRoutes(syntheticFile);
      expect(routeResolvesTeamFrom(route, syntheticFile, "loadWidgetTeamId")).toBe(false);
    });
  });

  // Regression tests for M2: a route registered through a shape extractRoutes
  // does not understand must be flagged loudly, not silently dropped.
  describe("unrecognized apiRouter registration shapes are flagged, not silently skipped", () => {
    it("flags .route() chaining", () => {
      const synthetic = `apiRouter.route("/widgets/:id").delete(asyncHandler(async (req, res) => {}));`;
      const syntheticFile = ts.createSourceFile("synthetic.ts", synthetic, ts.ScriptTarget.Latest, true);
      const issues = findUnrecognizedApiRouterUsages(syntheticFile);
      expect(issues.length).toBeGreaterThan(0);
      expect(extractRoutes(syntheticFile)).toEqual([]);
    });

    it("flags .use() sub-router mounting", () => {
      const synthetic = `apiRouter.use("/widgets", widgetsRouter);`;
      const syntheticFile = ts.createSourceFile("synthetic.ts", synthetic, ts.ScriptTarget.Latest, true);
      const issues = findUnrecognizedApiRouterUsages(syntheticFile);
      expect(issues.length).toBeGreaterThan(0);
    });

    it("flags a non-literal (template-literal) path on an otherwise-recognized method", () => {
      const synthetic = "apiRouter.delete(`/widgets/${id}`, asyncHandler(async (req, res) => {}));";
      const syntheticFile = ts.createSourceFile("synthetic.ts", synthetic, ts.ScriptTarget.Latest, true);
      const issues = findUnrecognizedApiRouterUsages(syntheticFile);
      expect(issues.length).toBeGreaterThan(0);
      expect(extractRoutes(syntheticFile)).toEqual([]);
    });

    it("flags an aliased router (const alias = apiRouter; alias.post(...))", () => {
      const synthetic = `const alias = apiRouter;\n        alias.post("/widgets", asyncHandler(async (req, res) => {}));`;
      const syntheticFile = ts.createSourceFile("synthetic.ts", synthetic, ts.ScriptTarget.Latest, true);
      expect(findUnrecognizedApiRouterUsages(syntheticFile).length).toBeGreaterThan(0);
      expect(extractRoutes(syntheticFile)).toEqual([]);
    });

    it('flags element-access registration (apiRouter["delete"](...))', () => {
      const synthetic = `apiRouter["delete"]("/widgets/:id", asyncHandler(async (req, res) => {}));`;
      const syntheticFile = ts.createSourceFile("synthetic.ts", synthetic, ts.ScriptTarget.Latest, true);
      expect(findUnrecognizedApiRouterUsages(syntheticFile).length).toBeGreaterThan(0);
      expect(extractRoutes(syntheticFile)).toEqual([]);
    });

    it("flags a detached method reference (const post = apiRouter.post)", () => {
      const synthetic = `const post = apiRouter.post;`;
      const syntheticFile = ts.createSourceFile("synthetic.ts", synthetic, ts.ScriptTarget.Latest, true);
      expect(findUnrecognizedApiRouterUsages(syntheticFile).length).toBeGreaterThan(0);
    });

    it("flags destructuring the router (const { post } = apiRouter)", () => {
      const synthetic = `const { post } = apiRouter;`;
      const syntheticFile = ts.createSourceFile("synthetic.ts", synthetic, ts.ScriptTarget.Latest, true);
      expect(findUnrecognizedApiRouterUsages(syntheticFile).length).toBeGreaterThan(0);
    });

    it("flags passing the router on (register(apiRouter))", () => {
      const synthetic = `register(apiRouter);`;
      const syntheticFile = ts.createSourceFile("synthetic.ts", synthetic, ts.ScriptTarget.Latest, true);
      expect(findUnrecognizedApiRouterUsages(syntheticFile).length).toBeGreaterThan(0);
    });

    it("does not flag the router's own declaration (negative control)", () => {
      const synthetic = `export const apiRouter = Router();\n        apiRouter.get("/widgets", asyncHandler(async (req, res) => {}));`;
      const syntheticFile = ts.createSourceFile("synthetic.ts", synthetic, ts.ScriptTarget.Latest, true);
      expect(findUnrecognizedApiRouterUsages(syntheticFile)).toEqual([]);
    });

    it("does not flag a normal, recognized route registration (negative control)", () => {
      const synthetic = `apiRouter.delete("/widgets/:id", asyncHandler(async (req, res) => {}));`;
      const syntheticFile = ts.createSourceFile("synthetic.ts", synthetic, ts.ScriptTarget.Latest, true);
      expect(findUnrecognizedApiRouterUsages(syntheticFile)).toEqual([]);
    });
  });
});
