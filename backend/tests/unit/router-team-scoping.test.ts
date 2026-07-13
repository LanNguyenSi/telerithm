import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import ts from "typescript";

// Structural guard for the by-id-write-route team-scoping convention (see
// `requireResourceTeam`'s doc comment in router.ts, and ENGINEERING.md).
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
// ROUTE_TEAM_GUARDS below: either `{ kind: "resolver" }`, naming a
// requireResourceTeam-built resolver the handler must call, or
// `{ kind: "allowlist" }`, an explicit, justified exception.
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
const ROUTER_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../src/api/rest/router.ts",
);

const STATE_CHANGING_METHODS = new Set(["post", "put", "patch", "delete"]);
const HTTP_METHOD_NAMES = new Set(["get", "post", "put", "patch", "delete"]);

// A guard's runtime evidence requirement: either a real call to a named
// function/method (`type: "call"`, optionally also requiring a specific
// identifier to appear among that call's own arguments), or a bare
// identifier reference (`type: "identifier"`, for middleware passed by
// reference rather than invoked directly, e.g. `authenticateApiKey`).
type Verify =
  | { type: "call"; callee: string; alsoReferences?: string }
  | { type: "identifier"; name: string };

type Guard =
  | { kind: "resolver"; resolverName: string }
  | { kind: "allowlist"; reason: string; verify?: Verify };

// Every state-changing route in router.ts whose path contains a `:param`,
// keyed by "METHOD /path" exactly as declared there.
const ROUTE_TEAM_GUARDS: Record<string, Guard> = {
  // --- Resource-derived team resolvers, built via requireResourceTeam ---
  "POST /alerts/rules/:id/mute": { kind: "resolver", resolverName: "requireRuleTeam" },
  "POST /alerts/rules/:id/unmute": { kind: "resolver", resolverName: "requireRuleTeam" },
  "DELETE /maintenance-windows/:id": { kind: "resolver", resolverName: "requireMaintenanceWindowTeam" },
  "POST /alerts/incidents/:id/acknowledge": { kind: "resolver", resolverName: "requireIncidentTeam" },
  "POST /alerts/incidents/:id/resolve": { kind: "resolver", resolverName: "requireIncidentTeam" },
  "POST /alerts/incidents/:id/reopen": { kind: "resolver", resolverName: "requireIncidentTeam" },
  "PUT /issues/:id": { kind: "resolver", resolverName: "requireIssueTeam" },

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

interface RouteDecl {
  method: string;
  routePath: string;
  // The AST nodes for every argument after the path string (rate limiters,
  // auth middleware, the asyncHandler body, ...), kept as nodes (not text) so
  // verification can walk real CallExpression/Identifier nodes instead of
  // substring-searching raw source text, which would also match comments.
  argNodes: ts.Expression[];
}

// Walks a router.ts-shaped AST for `apiRouter.<method>("path", ...middleware)`
// call expressions and collects, per route, its HTTP method, its path, and
// the argument nodes after the path.
function extractRoutes(sourceFile: ts.SourceFile): RouteDecl[] {
  const routes: RouteDecl[] = [];

  function visit(node: ts.Node): void {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ts.isIdentifier(node.expression.expression) &&
      node.expression.expression.text === "apiRouter" &&
      HTTP_METHOD_NAMES.has(node.expression.name.text.toLowerCase())
    ) {
      const [pathArg, ...rest] = node.arguments;
      if (pathArg && ts.isStringLiteral(pathArg)) {
        routes.push({
          method: node.expression.name.text.toLowerCase(),
          routePath: pathArg.text,
          argNodes: rest,
        });
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return routes;
}

// Fails loudly (as data for a test assertion, not a thrown error) on any
// `apiRouter.<member>(...)` call extractRoutes does not understand: a member
// name outside get/post/put/patch/delete (`.route()` chaining, `.use()`
// sub-router mounting, ...), or a recognized method whose first argument
// isn't a plain string literal (a template literal or variable path).
// Without this, such a route would silently never reach ROUTE_TEAM_GUARDS
// classification at all — the "every route is classified" test can only
// catch gaps in routes it can see.
function findUnrecognizedApiRouterUsages(
  sourceFile: ts.SourceFile,
): Array<{ snippet: string; reason: string }> {
  const issues: Array<{ snippet: string; reason: string }> = [];

  function visit(node: ts.Node): void {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ts.isIdentifier(node.expression.expression) &&
      node.expression.expression.text === "apiRouter"
    ) {
      const member = node.expression.name.text;
      const snippet = node.getText(sourceFile).split("\n")[0].trim();
      if (!HTTP_METHOD_NAMES.has(member.toLowerCase())) {
        issues.push({
          snippet,
          reason:
            `apiRouter.${member}(...) is not one of get/post/put/patch/delete. extractRoutes only recognizes ` +
            "those five direct method calls with a string-literal path and would silently skip this " +
            "registration (e.g. .route() chaining or .use() sub-router mounting). Extend extractRoutes to " +
            "handle this shape, then classify any resulting routes in ROUTE_TEAM_GUARDS.",
        });
      } else {
        const [pathArg] = node.arguments;
        if (!pathArg || !ts.isStringLiteral(pathArg)) {
          issues.push({
            snippet,
            reason:
              `apiRouter.${member}(...) does not have a plain string literal as its first argument (e.g. a ` +
              "template literal or a variable path). extractRoutes cannot statically extract a path from this " +
              "call and would silently skip it. Extend extractRoutes to handle this shape.",
          });
        }
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return issues;
}

// True if `root`'s subtree contains a CallExpression whose callee's exact
// source text equals `calleeText` (e.g. "requireIncidentTeam" or
// "subscriptionService.update"). Comments are trivia, not AST nodes, so
// `ts.forEachChild` never visits them — a comment merely mentioning the name
// cannot satisfy this.
function findCallByCallee(
  root: ts.Node,
  sourceFile: ts.SourceFile,
  calleeText: string,
): ts.CallExpression | null {
  let match: ts.CallExpression | null = null;

  function visit(node: ts.Node): void {
    if (match) return;
    if (ts.isCallExpression(node) && node.expression.getText(sourceFile) === calleeText) {
      match = node;
      return;
    }
    ts.forEachChild(node, visit);
  }

  visit(root);
  return match;
}

// True if `root`'s subtree contains an Identifier node with text `name`
// (a reference, not a comment).
function containsIdentifier(root: ts.Node, name: string): boolean {
  let found = false;

  function visit(node: ts.Node): void {
    if (found) return;
    if (ts.isIdentifier(node) && node.text === name) {
      found = true;
      return;
    }
    ts.forEachChild(node, visit);
  }

  visit(root);
  return found;
}

function routeCallsResolver(route: RouteDecl, sourceFile: ts.SourceFile, resolverName: string): boolean {
  return route.argNodes.some((node) => findCallByCallee(node, sourceFile, resolverName) !== null);
}

function routeSatisfiesVerify(route: RouteDecl, sourceFile: ts.SourceFile, verify: Verify): boolean {
  if (verify.type === "identifier") {
    return route.argNodes.some((node) => containsIdentifier(node, verify.name));
  }
  for (const node of route.argNodes) {
    const call = findCallByCallee(node, sourceFile, verify.callee);
    if (call) {
      return verify.alsoReferences ? containsIdentifier(call, verify.alsoReferences) : true;
    }
  }
  return false;
}

const routerSource = readFileSync(ROUTER_PATH, "utf8");
const routerSourceFile = ts.createSourceFile(ROUTER_PATH, routerSource, ts.ScriptTarget.Latest, true);
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
    const actual = new Set(writeIdRoutes.map((r) => `${r.method.toUpperCase()} ${r.routePath}`));
    const registered = new Set(Object.keys(ROUTE_TEAM_GUARDS));

    const unclassified = [...actual].filter((key) => !registered.has(key));
    const stale = [...registered].filter((key) => !actual.has(key));

    expect(
      unclassified,
      "New state-changing by-id route(s) added to router.ts with no team-scoping classification. Add an " +
        'entry to ROUTE_TEAM_GUARDS in this test: either { kind: "resolver" } naming a requireResourceTeam-built ' +
        'resolver the route must call, or a justified { kind: "allowlist" }.',
    ).toEqual([]);
    expect(
      stale,
      "ROUTE_TEAM_GUARDS has entries for routes no longer present in router.ts. Remove the stale entries.",
    ).toEqual([]);
  });

  for (const route of writeIdRoutes) {
    const key = `${route.method.toUpperCase()} ${route.routePath}`;
    const guard = ROUTE_TEAM_GUARDS[key];

    it(`${key} enforces its declared guard`, () => {
      if (!guard) {
        // Already reported by "every route is classified" above; skip here
        // instead of producing a second, confusing failure for the same gap.
        return;
      }
      if (guard.kind === "resolver") {
        expect(
          routeCallsResolver(route, routerSourceFile, guard.resolverName),
          `Expected ${key} to actually call ${guard.resolverName}(...) to resolve and authorize the resource's ` +
            "team (a mention in a comment does not count).",
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
  // resolver name appearing only in a comment. Switching to real AST
  // CallExpression matching (findCallByCallee/routeCallsResolver above)
  // fixes that; these tests pin the fix against regressing back to a
  // substring check.
  describe("comment-only mentions do not satisfy a guard", () => {
    it("a resolver name mentioned only in a comment is NOT detected as an actual call (negative control)", () => {
      const synthetic = `
        apiRouter.delete(
          "/widgets/:id",
          asyncHandler(async (req, res) => {
            // requireMaintenanceWindowTeam( used to be called here; a naive
            // substring check over the handler's source text would still
            // "see" this comment and wrongly consider the route guarded.
            const userId = await requireAuth(req, res);
            if (userId === null) return;
            await prisma.widget.delete({ where: { id: String(req.params.id) } });
            res.status(204).end();
          }),
        );
      `;
      const syntheticFile = ts.createSourceFile("synthetic.ts", synthetic, ts.ScriptTarget.Latest, true);
      const [route] = extractRoutes(syntheticFile);
      expect(route).toBeDefined();
      expect(routeCallsResolver(route, syntheticFile, "requireMaintenanceWindowTeam")).toBe(false);
    });

    it("a resolver name that IS actually called IS detected (positive control)", () => {
      const synthetic = `
        apiRouter.delete(
          "/widgets/:id",
          asyncHandler(async (req, res) => {
            const userId = await requireAuth(req, res);
            if (userId === null) return;
            const teamId = await requireMaintenanceWindowTeam(String(req.params.id), userId, res);
            if (teamId === null) return;
            await prisma.widget.delete({ where: { id: String(req.params.id), teamId } });
            res.status(204).end();
          }),
        );
      `;
      const syntheticFile = ts.createSourceFile("synthetic.ts", synthetic, ts.ScriptTarget.Latest, true);
      const [route] = extractRoutes(syntheticFile);
      expect(routeCallsResolver(route, syntheticFile, "requireMaintenanceWindowTeam")).toBe(true);
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

    it("does not flag a normal, recognized route registration (negative control)", () => {
      const synthetic = `apiRouter.delete("/widgets/:id", asyncHandler(async (req, res) => {}));`;
      const syntheticFile = ts.createSourceFile("synthetic.ts", synthetic, ts.ScriptTarget.Latest, true);
      expect(findUnrecognizedApiRouterUsages(syntheticFile)).toEqual([]);
    });
  });
});
