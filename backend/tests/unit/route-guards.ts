import type { Verify } from "./router-ast.js";

// The classification of every state-changing route in router.ts, shared by the
// static meta-test (router-write-role.test.ts, which reads router.ts as text)
// and the runtime route-table test (route-table.test.ts, which walks the
// Express stack of the real app).

// "write": a team-scoped mutation registered through writeRoute (VIEWER gets
// 403). "allowlist": an explicit, justified exception registered with
// apiRouter.<method> (reading POST, per-user, invite, admin, ingest, ...).
export type Guard = { kind: "write" } | { kind: "allowlist"; reason: string; verify?: Verify };

// Every state-changing route in router.ts, keyed "METHOD /path" exactly as
// declared there.
export const ROUTE_WRITE_GUARDS: Record<string, Guard> = {
  // --- Team-scoped writes through writeRoute: VIEWER gets 403 ---
  "POST /sources": { kind: "write" },
  "POST /alerts/rules/:id/mute": { kind: "write" },
  "POST /alerts/rules/:id/unmute": { kind: "write" },
  "POST /maintenance-windows": { kind: "write" },
  "DELETE /maintenance-windows/:id": { kind: "write" },
  "POST /alerts/incidents/:id/acknowledge": { kind: "write" },
  "POST /alerts/incidents/:id/resolve": { kind: "write" },
  "POST /alerts/incidents/:id/reopen": { kind: "write" },
  "PUT /issues/:id": { kind: "write" },

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
      "Saved-view model (owner plus canManageShared), outside the team write rule: any member, VIEWER included, " +
      "may create a private view, because it is per-user state. Team-wide state is gated inside the handler: " +
      "isShared: true or isDefault: true (which clears the default flag of every shared view in the team) " +
      "needs canManageShared (OWNER/ADMIN) and otherwise answers 403 before any service call. " +
      "Membership is required via requireTeamRole.",
    verify: { type: "call", callee: "requireTeamRole" },
  },
  "PUT /logs/views/:id": {
    kind: "allowlist",
    reason:
      "Saved-view model, outside the team write rule: LogViewService lets the owner of a view update it and " +
      "OWNER/ADMIN (canManageShared) update shared views, so a VIEWER may edit its own private view. " +
      "Team-wide state is gated inside the handler: isShared: true or isDefault: true needs canManageShared " +
      "(OWNER/ADMIN) and otherwise answers 403 before the service runs, so no default flag is cleared. " +
      "The service also refuses MEMBER/VIEWER (403, no mutation) on a loaded view that is already shared or " +
      "default, owner or not.",
    verify: { type: "call", callee: "requireTeamRole" },
  },
  "POST /logs/views/:id/duplicate": {
    kind: "allowlist",
    reason:
      "Saved-view model: LogViewService.duplicate checks canRead (shared view or the caller's own) and keeps " +
      "isShared only when canManageShared is true.",
    verify: { type: "call", callee: "requireTeamRole" },
  },
  "DELETE /logs/views/:id": {
    kind: "allowlist",
    reason:
      "Same saved-view owner/canManageShared model as PUT /logs/views/:id, including the service-side refusal " +
      "of MEMBER/VIEWER on a shared or default view.",
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
