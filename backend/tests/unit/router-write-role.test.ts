import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import ts from "typescript";

// Structural guard for the "VIEWER is read-only on team-scoped writes" rule
// (see `canWrite` / `requireTeamWriteRole` in router.ts, and ENGINEERING.md).
//
// The rule has exactly one home: `canWrite(role)` in router.ts, reached through
// `requireTeamWriteRole` (called directly by routes that take their teamId
// from the body) or through a `requireResourceTeam` resolver built in "write"
// mode (by-id routes). This test makes sure no state-changing route can skip
// it unnoticed. Like router-team-scoping.test.ts it parses router.ts with the
// TypeScript compiler API instead of importing it (importing would construct
// live Prisma/ClickHouse/Redis-backed services as a module-load side effect).
//
// Difference to router-team-scoping.test.ts: that guard only covers routes
// with a `:param`; this one classifies EVERY state-changing apiRouter route
// (POST/PUT/PATCH/DELETE), with or without a path parameter, because
// POST /sources and POST /maintenance-windows take their teamId from the body.
//
// Every state-changing route MUST appear in ROUTE_WRITE_GUARDS as either
//   { kind: "write", gate }        the handler contains a real CallExpression
//                                  to a write gate (a mention in a comment
//                                  does not count), or
//   { kind: "allowlist", reason }  an explicit, justified exception (reading
//                                  POST, per-user, invite, admin, ingest, ...).
// A route in router.ts that is missing here fails CI, so a new mutating route
// cannot ship without someone deciding which of the two it is.
const ROUTER_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../src/api/rest/router.ts",
);

const STATE_CHANGING_METHODS = new Set(["post", "put", "patch", "delete"]);
const HTTP_METHOD_NAMES = new Set(["get", "post", "put", "patch", "delete"]);

// Functions that apply the write rule. requireTeamWriteRole is the direct
// helper; the others are requireResourceTeam resolvers built in "write" mode.
const WRITE_GATES = [
  "requireTeamWriteRole",
  "requireRuleWriteTeam",
  "requireMaintenanceWindowWriteTeam",
  "requireIncidentWriteTeam",
  "requireIssueWriteTeam",
] as const;
type WriteGate = (typeof WRITE_GATES)[number];

// The subset of WRITE_GATES that must be a requireResourceTeam(..., "write")
// instantiation (everything except the direct helper).
const WRITE_RESOLVERS = WRITE_GATES.filter((g) => g !== "requireTeamWriteRole");

type Verify =
  | { type: "call"; callee: string; alsoReferences?: string }
  | { type: "identifier"; name: string };

type Guard = { kind: "write"; gate: WriteGate } | { kind: "allowlist"; reason: string; verify?: Verify };

// Every state-changing route in router.ts, keyed "METHOD /path" exactly as
// declared there.
const ROUTE_WRITE_GUARDS: Record<string, Guard> = {
  // --- Team-scoped writes: VIEWER gets 403 ---
  "POST /sources": { kind: "write", gate: "requireTeamWriteRole" },
  "POST /alerts/rules/:id/mute": { kind: "write", gate: "requireRuleWriteTeam" },
  "POST /alerts/rules/:id/unmute": { kind: "write", gate: "requireRuleWriteTeam" },
  "POST /maintenance-windows": { kind: "write", gate: "requireTeamWriteRole" },
  "DELETE /maintenance-windows/:id": { kind: "write", gate: "requireMaintenanceWindowWriteTeam" },
  "POST /alerts/incidents/:id/acknowledge": { kind: "write", gate: "requireIncidentWriteTeam" },
  "POST /alerts/incidents/:id/resolve": { kind: "write", gate: "requireIncidentWriteTeam" },
  "POST /alerts/incidents/:id/reopen": { kind: "write", gate: "requireIncidentWriteTeam" },
  "PUT /issues/:id": { kind: "write", gate: "requireIssueWriteTeam" },

  // --- Explicit, justified allowlist (never a silent skip) ---
  "POST /auth/register": {
    kind: "allowlist",
    reason: "Public sign-up, no session and no team yet; abuse is bounded by authLimiter.",
    verify: { type: "identifier", name: "authLimiter" },
  },
  "POST /auth/login": {
    kind: "allowlist",
    reason: "Public login, no session and no team yet; abuse is bounded by authLimiter.",
    verify: { type: "identifier", name: "authLimiter" },
  },
  "POST /teams": {
    kind: "allowlist",
    reason:
      "Creates a brand-new team for the authenticated caller, who becomes its owner; there is no existing team " +
      "membership or role to check yet.",
    verify: { type: "call", callee: "requireAuth" },
  },
  "POST /ingest/:sourceId": {
    kind: "allowlist",
    reason:
      "Machine ingestion authenticated by an API key pinned 1:1 to a single source (authenticateApiKey); there " +
      "is no user session and no team role to apply.",
    verify: { type: "identifier", name: "authenticateApiKey" },
  },
  "POST /ingest/:sourceId/raw": {
    kind: "allowlist",
    reason: "Same API-key boundary as POST /ingest/:sourceId.",
    verify: { type: "identifier", name: "authenticateApiKey" },
  },
  "POST /logs/search": {
    kind: "allowlist",
    reason:
      "Reading POST (the filter payload is too large for a query string); it mutates nothing, so a VIEWER may " +
      "use it. Team membership is still required via requireTeamRole.",
    verify: { type: "call", callee: "requireTeamRole" },
  },
  "POST /logs/context": {
    kind: "allowlist",
    reason: "Reading POST like POST /logs/search; mutates nothing, membership required.",
    verify: { type: "call", callee: "requireTeamRole" },
  },
  "POST /logs/facets": {
    kind: "allowlist",
    reason: "Reading POST like POST /logs/search; mutates nothing, membership required.",
    verify: { type: "call", callee: "requireTeamRole" },
  },
  "POST /logs/histogram": {
    kind: "allowlist",
    reason: "Reading POST like POST /logs/search; mutates nothing, membership required.",
    verify: { type: "call", callee: "requireTeamRole" },
  },
  "POST /logs/patterns": {
    kind: "allowlist",
    reason: "Reading POST like POST /logs/search; mutates nothing, membership required.",
    verify: { type: "call", callee: "requireTeamRole" },
  },
  "POST /query/natural": {
    kind: "allowlist",
    reason:
      "Reading POST: translates a natural-language question into an explained query and mutates no team data; " +
      "membership required via requireTeamRole.",
    verify: { type: "call", callee: "requireTeamRole" },
  },
  "POST /logs/views": {
    kind: "allowlist",
    reason:
      "Saved-view model (owner plus canManageShared), outside the team write rule; whether a VIEWER may create a " +
      "shared view is a separate open question tracked as its own follow-up task. Membership is required via " +
      "requireTeamRole.",
    verify: { type: "call", callee: "requireTeamRole" },
  },
  "PUT /logs/views/:id": {
    kind: "allowlist",
    reason:
      "Saved-view model: LogViewService scopes the mutation to the owner, or to OWNER/ADMIN (canManageShared) " +
      "for shared views; a VIEWER can only touch their own views.",
    verify: { type: "call", callee: "requireTeamRole" },
  },
  "POST /logs/views/:id/duplicate": {
    kind: "allowlist",
    reason: "Same saved-view owner/canManageShared model as PUT /logs/views/:id.",
    verify: { type: "call", callee: "requireTeamRole" },
  },
  "DELETE /logs/views/:id": {
    kind: "allowlist",
    reason: "Same saved-view owner/canManageShared model as PUT /logs/views/:id.",
    verify: { type: "call", callee: "requireTeamRole" },
  },
  "POST /subscriptions": {
    kind: "allowlist",
    reason:
      "Subscriptions are per-user (the row is keyed to the caller's userId), not shared team data, so the team " +
      "write rule does not apply; membership is still required via requireTeamRole.",
    verify: { type: "call", callee: "subscriptionService.create", alsoReferences: "userId" },
  },
  "PUT /subscriptions/:id": {
    kind: "allowlist",
    reason: "Per-user subscription: the update is scoped by (id, userId) in SubscriptionService.",
    verify: { type: "call", callee: "subscriptionService.update", alsoReferences: "userId" },
  },
  "DELETE /subscriptions/:id": {
    kind: "allowlist",
    reason: "Per-user subscription: the delete is scoped by (id, userId) in SubscriptionService.",
    verify: { type: "call", callee: "subscriptionService.delete", alsoReferences: "userId" },
  },
  "POST /subscriptions/:id/test": {
    kind: "allowlist",
    reason:
      "Per-user subscription: loads it with (id, userId) and only sends a test notification to the caller's own " +
      "channel; no team data is mutated.",
    verify: { type: "call", callee: "prisma.alertSubscription.findFirst", alsoReferences: "userId" },
  },
  "POST /teams/:id/invites": {
    kind: "allowlist",
    reason: "Invite management has its own stricter rule: canManageInvites (OWNER/ADMIN only).",
    verify: { type: "call", callee: "canManageInvites" },
  },
  "POST /invites/:token/accept": {
    kind: "allowlist",
    reason:
      "Authorization is the unforgeable, single-use, expiring invite token itself (capability token); the " +
      "accepting user is not a team member yet, so there is no role to check.",
  },
  "DELETE /invites/:id": {
    kind: "allowlist",
    reason: "Invite management has its own stricter rule: canManageInvites (OWNER/ADMIN only).",
    verify: { type: "call", callee: "canManageInvites" },
  },
  "PUT /admin/users/:id": {
    kind: "allowlist",
    reason: "requireAdmin gates on the global admin role, which supersedes team roles by design.",
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
  // Argument nodes after the path string, kept as AST nodes (not text) so
  // verification walks real CallExpression/Identifier nodes and a comment
  // mentioning a gate name can never satisfy it.
  argNodes: ts.Expression[];
}

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

// `apiRouter.<member>(...)` shapes extractRoutes does not understand (.route()
// chaining, .use() sub-router mounts, a non-literal path) would silently
// escape classification, so they are reported as data for a test assertion.
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
            `apiRouter.${member}(...) is not one of get/post/put/patch/delete; extractRoutes would silently skip ` +
            "it. Extend extractRoutes, then classify any resulting routes in ROUTE_WRITE_GUARDS.",
        });
      } else {
        const [pathArg] = node.arguments;
        if (!pathArg || !ts.isStringLiteral(pathArg)) {
          issues.push({
            snippet,
            reason:
              `apiRouter.${member}(...) has no plain string literal as its first argument; extractRoutes cannot ` +
              "extract a path from it and would silently skip it.",
          });
        }
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return issues;
}

// First CallExpression in `root`'s subtree whose callee's exact source text
// equals `calleeText`. Comments are trivia, not AST nodes, so a comment
// mentioning the name cannot match.
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

function routeCallsGate(route: RouteDecl, sourceFile: ts.SourceFile, gate: string): boolean {
  return route.argNodes.some((node) => findCallByCallee(node, sourceFile, gate) !== null);
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

function findFunctionDeclarations(sourceFile: ts.SourceFile, name: string): ts.FunctionDeclaration[] {
  const found: ts.FunctionDeclaration[] = [];
  function visit(node: ts.Node): void {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) found.push(node);
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return found;
}

// `const <name> = requireResourceTeam(<loader>, <message>, <mode>)`: returns
// the mode argument's string-literal value, or null when the declaration is
// missing or not shaped like that.
function resolverMode(sourceFile: ts.SourceFile, name: string): string | null {
  let mode: string | null = null;
  function visit(node: ts.Node): void {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === name &&
      node.initializer &&
      ts.isCallExpression(node.initializer) &&
      node.initializer.expression.getText(sourceFile) === "requireResourceTeam"
    ) {
      const modeArg = node.initializer.arguments[2];
      if (modeArg && ts.isStringLiteral(modeArg)) mode = modeArg.text;
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return mode;
}

const routerSource = readFileSync(ROUTER_PATH, "utf8");
const routerSourceFile = ts.createSourceFile(ROUTER_PATH, routerSource, ts.ScriptTarget.Latest, true);
const allRoutes = extractRoutes(routerSourceFile);
const stateChangingRoutes = allRoutes.filter((r) => STATE_CHANGING_METHODS.has(r.method));

describe("router.ts: every state-changing route is classified for the team write rule", () => {
  it("found state-changing routes both with and without a :param (sanity check the AST walk isn't empty)", () => {
    expect(stateChangingRoutes.some((r) => r.routePath.includes(":"))).toBe(true);
    expect(stateChangingRoutes.some((r) => !r.routePath.includes(":"))).toBe(true);
  });

  it("router.ts has no apiRouter registration shape the AST walker cannot classify", () => {
    expect(
      findUnrecognizedApiRouterUsages(routerSourceFile),
      "Found apiRouter usage(s) the write-role guard's walker does not understand; they would silently escape " +
        "classification below.",
    ).toEqual([]);
  });

  it("every state-changing route is classified in ROUTE_WRITE_GUARDS", () => {
    const actual = new Set(stateChangingRoutes.map((r) => `${r.method.toUpperCase()} ${r.routePath}`));
    const registered = new Set(Object.keys(ROUTE_WRITE_GUARDS));

    const unclassified = [...actual].filter((key) => !registered.has(key));
    const stale = [...registered].filter((key) => !actual.has(key));

    expect(
      unclassified,
      "New state-changing route(s) in router.ts with no write-role classification. Add an entry to " +
        'ROUTE_WRITE_GUARDS in this test: { kind: "write", gate } for a team-scoped mutation (VIEWER must get ' +
        '403), or a justified { kind: "allowlist" } for a reading POST, per-user, invite, admin or ingest route.',
    ).toEqual([]);
    expect(
      stale,
      "ROUTE_WRITE_GUARDS has entries for routes no longer present in router.ts. Remove the stale entries.",
    ).toEqual([]);
  });

  for (const route of stateChangingRoutes) {
    const key = `${route.method.toUpperCase()} ${route.routePath}`;
    const guard = ROUTE_WRITE_GUARDS[key];

    it(`${key} enforces its declared guard`, () => {
      if (!guard) return; // reported by the classification test above
      if (guard.kind === "write") {
        expect(
          routeCallsGate(route, routerSourceFile, guard.gate),
          `Expected ${key} to actually call ${guard.gate}(...) so a VIEWER is refused before any mutation (a ` +
            "mention in a comment does not count).",
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
    for (const [key, guard] of Object.entries(ROUTE_WRITE_GUARDS)) {
      if (guard.kind === "allowlist") {
        expect(guard.reason.length, `Allowlist entry for ${key} needs a real justification.`).toBeGreaterThan(
          20,
        );
      }
    }
  });

  it("every write gate named for a route is one of the known write gates", () => {
    for (const [key, guard] of Object.entries(ROUTE_WRITE_GUARDS)) {
      if (guard.kind === "write") {
        expect(WRITE_GATES as readonly string[], `${key} names an unknown write gate`).toContain(guard.gate);
      }
    }
  });
});

describe("router.ts: the write rule has one home and the gates really apply it", () => {
  it("canWrite is declared exactly once", () => {
    expect(findFunctionDeclarations(routerSourceFile, "canWrite")).toHaveLength(1);
  });

  it("requireTeamWriteRole is declared once and its body calls both requireTeamRole and canWrite", () => {
    const decls = findFunctionDeclarations(routerSourceFile, "requireTeamWriteRole");
    expect(decls).toHaveLength(1);
    expect(findCallByCallee(decls[0], routerSourceFile, "requireTeamRole")).not.toBeNull();
    expect(findCallByCallee(decls[0], routerSourceFile, "canWrite")).not.toBeNull();
  });

  it('every write resolver is a requireResourceTeam(..., "write") instantiation', () => {
    for (const name of WRITE_RESOLVERS) {
      expect(resolverMode(routerSourceFile, name), `${name} must be built in "write" mode`).toBe("write");
    }
  });

  it('the incident read resolver stays in "read" mode (the timeline remains readable for a VIEWER)', () => {
    expect(resolverMode(routerSourceFile, "requireIncidentTeam")).toBe("read");
  });

  it('requireResourceTeam picks requireTeamWriteRole for "write" mode and requireTeamRole otherwise', () => {
    const decls = findFunctionDeclarations(routerSourceFile, "requireResourceTeam");
    expect(decls).toHaveLength(1);
    let conditional: ts.ConditionalExpression | null = null;
    (function visit(node: ts.Node): void {
      if (conditional) return;
      if (ts.isConditionalExpression(node) && node.condition.getText(routerSourceFile).includes('"write"')) {
        conditional = node;
        return;
      }
      ts.forEachChild(node, visit);
    })(decls[0]);
    expect(conditional, 'requireResourceTeam must branch on its "write" mode').not.toBeNull();
    const branch = conditional as unknown as ts.ConditionalExpression;
    expect(findCallByCallee(branch.whenTrue, routerSourceFile, "requireTeamWriteRole")).not.toBeNull();
    expect(findCallByCallee(branch.whenFalse, routerSourceFile, "requireTeamRole")).not.toBeNull();
  });

  // Regression tests: a gate name that appears only in a comment must not
  // count as a call (a substring check over the handler text would wrongly
  // accept it), while a real call must.
  describe("comment-only mentions do not satisfy a write gate", () => {
    it("a gate mentioned only in a comment is NOT detected (negative control)", () => {
      const synthetic = `
        apiRouter.post(
          "/widgets",
          asyncHandler(async (req, res) => {
            // requireTeamWriteRole( used to run here; a substring check over the
            // handler text would still "see" this comment.
            const userId = await requireAuth(req, res);
            if (userId === null) return;
            await requireTeamRole(userId, req.body.teamId, res);
            await prisma.widget.create({ data: {} });
          }),
        );
      `;
      const file = ts.createSourceFile("synthetic.ts", synthetic, ts.ScriptTarget.Latest, true);
      const [route] = extractRoutes(file);
      expect(route).toBeDefined();
      expect(routeCallsGate(route, file, "requireTeamWriteRole")).toBe(false);
    });

    it("a gate that IS called is detected (positive control)", () => {
      const synthetic = `
        apiRouter.post(
          "/widgets",
          asyncHandler(async (req, res) => {
            const userId = await requireAuth(req, res);
            if (userId === null) return;
            if ((await requireTeamWriteRole(userId, req.body.teamId, res)) === null) return;
            await prisma.widget.create({ data: {} });
          }),
        );
      `;
      const file = ts.createSourceFile("synthetic.ts", synthetic, ts.ScriptTarget.Latest, true);
      const [route] = extractRoutes(file);
      expect(routeCallsGate(route, file, "requireTeamWriteRole")).toBe(true);
    });

    it("a write resolver mentioned only in a comment is NOT detected (negative control)", () => {
      const synthetic = `
        apiRouter.delete(
          "/widgets/:id",
          asyncHandler(async (req, res) => {
            // requireIncidentWriteTeam( was removed from this handler.
            const teamId = await requireIncidentTeam(String(req.params.id), userId, res);
            await prisma.widget.delete({ where: { id: String(req.params.id), teamId } });
          }),
        );
      `;
      const file = ts.createSourceFile("synthetic.ts", synthetic, ts.ScriptTarget.Latest, true);
      const [route] = extractRoutes(file);
      expect(routeCallsGate(route, file, "requireIncidentWriteTeam")).toBe(false);
    });
  });

  // A new mutating route that nobody classified must be visible to the
  // classification diff above, whether or not it has a :param.
  describe("an unclassified mutating route is reported", () => {
    it("a new POST without a :param is extracted as state-changing and absent from the registry", () => {
      const synthetic = `apiRouter.post("/widgets", asyncHandler(async (req, res) => {}));`;
      const file = ts.createSourceFile("synthetic.ts", synthetic, ts.ScriptTarget.Latest, true);
      const routes = extractRoutes(file).filter((r) => STATE_CHANGING_METHODS.has(r.method));
      const keys = routes.map((r) => `${r.method.toUpperCase()} ${r.routePath}`);
      expect(keys).toEqual(["POST /widgets"]);
      expect(Object.keys(ROUTE_WRITE_GUARDS)).not.toContain("POST /widgets");
    });

    it("a new DELETE with a :param is extracted as state-changing and absent from the registry", () => {
      const synthetic = `apiRouter.delete("/widgets/:id", asyncHandler(async (req, res) => {}));`;
      const file = ts.createSourceFile("synthetic.ts", synthetic, ts.ScriptTarget.Latest, true);
      const keys = extractRoutes(file)
        .filter((r) => STATE_CHANGING_METHODS.has(r.method))
        .map((r) => `${r.method.toUpperCase()} ${r.routePath}`);
      expect(keys).toEqual(["DELETE /widgets/:id"]);
      expect(Object.keys(ROUTE_WRITE_GUARDS)).not.toContain("DELETE /widgets/:id");
    });
  });

  describe("unrecognized apiRouter registration shapes are flagged, not silently skipped", () => {
    it("flags .route() chaining", () => {
      const synthetic = `apiRouter.route("/widgets/:id").delete(asyncHandler(async (req, res) => {}));`;
      const file = ts.createSourceFile("synthetic.ts", synthetic, ts.ScriptTarget.Latest, true);
      expect(findUnrecognizedApiRouterUsages(file).length).toBeGreaterThan(0);
      expect(extractRoutes(file)).toEqual([]);
    });

    it("flags a non-literal (template-literal) path", () => {
      const synthetic = "apiRouter.post(`/widgets/${id}`, asyncHandler(async (req, res) => {}));";
      const file = ts.createSourceFile("synthetic.ts", synthetic, ts.ScriptTarget.Latest, true);
      expect(findUnrecognizedApiRouterUsages(file).length).toBeGreaterThan(0);
      expect(extractRoutes(file)).toEqual([]);
    });

    it("does not flag a normal, recognized route registration (negative control)", () => {
      const synthetic = `apiRouter.post("/widgets", asyncHandler(async (req, res) => {}));`;
      const file = ts.createSourceFile("synthetic.ts", synthetic, ts.ScriptTarget.Latest, true);
      expect(findUnrecognizedApiRouterUsages(file)).toEqual([]);
    });
  });
});
