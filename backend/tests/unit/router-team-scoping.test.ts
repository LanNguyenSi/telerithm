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
// The actual structural enforcement is the "every route is classified" test:
// a route present in router.ts but absent from ROUTE_TEAM_GUARDS fails CI
// immediately, so a newly added by-id write route cannot go unreviewed for
// team-scoping — the author must consciously classify it here, which is a
// visible, reviewable diff line, not a silent omission.
const ROUTER_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../src/api/rest/router.ts",
);

const STATE_CHANGING_METHODS = new Set(["post", "put", "patch", "delete"]);

type Guard =
  | { kind: "resolver"; resolverName: string }
  | { kind: "allowlist"; reason: string; verifyContains?: string };

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
    verifyContains: "authenticateApiKey",
  },
  "POST /ingest/:sourceId/raw": {
    kind: "allowlist",
    reason: "Same API-key boundary as POST /ingest/:sourceId.",
    verifyContains: "authenticateApiKey",
  },
  "PUT /logs/views/:id": {
    kind: "allowlist",
    reason:
      "teamId comes from the request (query/body) and is membership-checked via requireTeamRole; " +
      "LogViewService.update then scopes the mutation by the compound (id, teamId) match and throws " +
      "NotFoundError on mismatch (see log-view-service.ts), so a foreign id paired with the caller's own " +
      "teamId 404s instead of mutating another team's view.",
    verifyContains: "requireTeamRole(",
  },
  "POST /logs/views/:id/duplicate": {
    kind: "allowlist",
    reason: "Same compound (id, teamId) service-layer scoping as PUT /logs/views/:id.",
    verifyContains: "requireTeamRole(",
  },
  "DELETE /logs/views/:id": {
    kind: "allowlist",
    reason: "Same compound (id, teamId) service-layer scoping as PUT /logs/views/:id.",
    verifyContains: "requireTeamRole(",
  },
  "PUT /subscriptions/:id": {
    kind: "allowlist",
    reason:
      "Subscriptions are scoped per-user, not per-team: SubscriptionService.update writes with " +
      "`where: { id, userId }`, so a foreign id paired with the caller's own userId matches nothing.",
    verifyContains: "subscriptionService.update(String(req.params.id), userId",
  },
  "DELETE /subscriptions/:id": {
    kind: "allowlist",
    reason: "Same per-user (id, userId) scoping as PUT /subscriptions/:id.",
    verifyContains: "subscriptionService.delete(String(req.params.id), userId",
  },
  "POST /subscriptions/:id/test": {
    kind: "allowlist",
    reason:
      "Loads the subscription with `where: { id, userId }`; same per-user scoping as the other subscription " +
      "routes.",
    verifyContains: "where: { id: String(req.params.id), userId }",
  },
  "POST /teams/:id/invites": {
    kind: "allowlist",
    reason:
      "The :id path parameter IS the team being operated on, not a separate resource that needs resolving to " +
      "a team; requireTeamRole is called directly against it, and canManageInvites further restricts to " +
      "OWNER/ADMIN.",
    verifyContains: "requireTeamRole(userId, teamId, res)",
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
    verifyContains: "requireTeamRole(userId, invite.teamId, res)",
  },
  "PUT /admin/users/:id": {
    kind: "allowlist",
    reason: "requireAdmin gates on global admin role, which supersedes team scoping by design.",
    verifyContains: "requireAdmin(",
  },
  "POST /admin/users/:id/approve": {
    kind: "allowlist",
    reason: "Same requireAdmin global-admin gate as PUT /admin/users/:id.",
    verifyContains: "requireAdmin(",
  },
  "POST /admin/users/:id/add-to-team": {
    kind: "allowlist",
    reason: "Same requireAdmin global-admin gate as PUT /admin/users/:id.",
    verifyContains: "requireAdmin(",
  },
  "DELETE /admin/users/:id/remove-from-team/:teamId": {
    kind: "allowlist",
    reason: "Same requireAdmin global-admin gate as PUT /admin/users/:id.",
    verifyContains: "requireAdmin(",
  },
  "DELETE /admin/teams/:id/members/:userId": {
    kind: "allowlist",
    reason: "Same requireAdmin global-admin gate as PUT /admin/users/:id.",
    verifyContains: "requireAdmin(",
  },
};

interface RouteDecl {
  method: string;
  routePath: string;
  handlerText: string;
}

// Walks router.ts's AST for `apiRouter.<method>("path", ...middleware)` call
// expressions and collects, per route, its HTTP method, its path, and the
// concatenated source text of every argument after the path (rate limiters,
// auth middleware, and the asyncHandler body) so callers can text-search the
// handler for a specific guard call.
function extractRoutes(source: string): RouteDecl[] {
  const sourceFile = ts.createSourceFile(ROUTER_PATH, source, ts.ScriptTarget.Latest, true);
  const routes: RouteDecl[] = [];

  function visit(node: ts.Node): void {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ts.isIdentifier(node.expression.expression) &&
      node.expression.expression.text === "apiRouter"
    ) {
      const [pathArg, ...rest] = node.arguments;
      if (pathArg && ts.isStringLiteral(pathArg)) {
        routes.push({
          method: node.expression.name.text.toLowerCase(),
          routePath: pathArg.text,
          handlerText: rest.map((arg) => arg.getText(sourceFile)).join("\n"),
        });
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return routes;
}

const routerSource = readFileSync(ROUTER_PATH, "utf8");
const allRoutes = extractRoutes(routerSource);
const writeIdRoutes = allRoutes.filter(
  (r) => STATE_CHANGING_METHODS.has(r.method) && /:[A-Za-z0-9_]+/.test(r.routePath),
);

describe("router.ts: by-id write routes must declare a team-scoping guard", () => {
  it("found at least one state-changing by-id route (sanity check the AST walk isn't silently empty)", () => {
    expect(writeIdRoutes.length).toBeGreaterThan(0);
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
          route.handlerText,
          `Expected ${key} to call ${guard.resolverName}(...) to resolve and authorize the resource's team.`,
        ).toContain(`${guard.resolverName}(`);
      } else if (guard.verifyContains) {
        expect(
          route.handlerText,
          `Expected ${key} (allowlisted: ${guard.reason}) to still contain "${guard.verifyContains}".`,
        ).toContain(guard.verifyContains);
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
});
