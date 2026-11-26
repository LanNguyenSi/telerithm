import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import express, { type Request, type Response, type NextFunction, Router } from "express";
import rateLimit, { ipKeyGenerator, type RateLimitInfo } from "express-rate-limit";
import { IngestionService, IngestBatchTooLargeError } from "../../ingestion/ingestion-service.js";
import { LogRepository } from "../../repositories/log-repository.js";
import { AlertService } from "../../services/alert/alert-service.js";
import { DashboardService } from "../../services/dashboard/dashboard-service.js";
import { QueryService, AsyncJobCapError, type SyncSlot } from "../../services/query/query-service.js";
import { LogViewService } from "../../services/log-view/log-view-service.js";
import { StreamingService } from "../../services/streaming/streaming-service.js";
import { IssueService } from "../../services/issue/issue-service.js";
import { SubscriptionService } from "../../services/subscription/subscription-service.js";
import { assertSafeUrl } from "../../services/notification/url-guard.js";
import { ChannelConfigError, ChannelHttpError } from "../../services/notification/channels/errors.js";
import { TeamService } from "../../services/team/team-service.js";
import {
  findActiveSession,
  findActiveSessionById,
  isSessionAuthorizedForTeam,
  isSessionIdAuthorizedForTeam,
} from "../../services/team/active-session.js";
import { consumeStreamTicket, issueStreamTicket } from "../../services/streaming/stream-ticket.js";
import { ConflictError, ForbiddenError, NotFoundError } from "../../errors.js";
import { createWriteRoute, teamFromBody, teamFromResource, type TeamRoleName } from "./write-route.js";
import {
  addUserToTeamSchema,
  createInviteSchema,
  createAlertRuleSchema,
  createSourceSchema,
  createSavedViewSchema,
  createSubscriptionSchema,
  createTeamSchema,
  incidentActionSchema,
  ingestSchema,
  MAX_INGEST_BATCH,
  issueQuerySchema,
  issueUpdateSchema,
  maintenanceWindowSchema,
  muteRuleSchema,
  loginSchema,
  naturalQuerySchema,
  registerSchema,
  renameSourceSchema,
  searchSchema,
  streamTicketSchema,
  contextSchema,
  facetsSchema,
  histogramSchema,
  patternsSchema,
  updateAlertRuleSchema,
  updateSavedViewSchema,
  updateSubscriptionSchema,
  updateUserRoleSchema,
} from "../../validation/schemas.js";
import { SEARCH_QUERY_MAX_TOKENS, searchQueryTokens } from "../../constants/search.js";
import { prisma } from "../../repositories/prisma.js";
import { clickhouse } from "../../repositories/clickhouse.js";
import { redis } from "../../repositories/redis.js";
import { createChildLogger } from "../../logger.js";
import { config } from "../../config/index.js";

const log = createChildLogger("router");

export const apiRouter = Router();

const DEFAULT_SEARCH_LOOKBACK_MS = 60 * 60 * 1000;

const teamService = new TeamService();
const queryService = new QueryService();
const logRepository = new LogRepository();
const alertService = new AlertService();
const dashboardService = new DashboardService();
const ingestionService = new IngestionService();
const streamingService = new StreamingService(ingestionService.events);
const subscriptionService = new SubscriptionService();
const issueService = new IssueService();
const logViewService = new LogViewService();

// 2.6 — Async error wrapper so unhandled rejections go to error middleware
function asyncHandler(fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res, next).catch(next);
  };
}

// The only way to register a team-scoped mutating route: authentication, team
// resolution and the team write gate run before the handler (see
// write-route.ts). Bound to apiRouter here, the one router instance.
const writeRoute = createWriteRoute({ router: apiRouter, requireAuth, requireTeamWriteRole });

// 2.1 — Strict rate limit for auth endpoints
const authLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: 20,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many authentication attempts, try again later" },
});

// 2.1 — Rate limit for ingest endpoint (high throughput)
const ingestLimiter = rateLimit({
  windowMs: 60_000,
  limit: 500,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Ingest rate limit exceeded" },
});

// Seconds until the current window resets, for the 429 body's `retryAfter`
// field. Mirrors the `Retry-After` header express-rate-limit already sets
// (standardHeaders enables that automatically); falls back to the
// configured window when `req.rateLimit` isn't populated yet.
function retryAfterSeconds(req: Request, windowMs: number): number {
  const info = (req as Request & { rateLimit?: RateLimitInfo }).rateLimit;
  if (info?.resetTime) {
    return Math.max(1, Math.ceil((info.resetTime.getTime() - Date.now()) / 1000));
  }
  return Math.ceil(windowMs / 1000);
}

function rateLimitHandler(message: string, windowMs: number) {
  return (req: Request, res: Response) => {
    res.status(429).json({ error: message, retryAfter: retryAfterSeconds(req, windowMs) });
  };
}

// Resolves the caller and attaches the user id to the request BEFORE any
// downstream middleware runs, unlike requireAuth (called inline inside each
// handler, after other middleware has already executed). This runs in front
// of notificationTestLimiter so the limiter can key on the resolved user
// id instead of the raw bearer token: keying on the token would let one
// user multiply their budget for free by logging in again (N sessions = N
// budgets, and sessions are cheap to create), and a limiter mounted before
// auth has no way to validate the token at all, so any caller-supplied
// string becomes its own bucket (unbounded key space). An unauthenticated
// or invalid request gets 401 here and never reaches the limiter below, so
// it never creates a bucket.
async function requireAuthMiddleware(req: Request, res: Response, next: NextFunction) {
  try {
    (req as Request & { userId?: string }).userId = await resolveUserId(req);
    next();
  } catch {
    res.status(401).json({ error: "Unauthorized" });
  }
}

// Keys the limiter per authenticated user, not per session token: two
// sessions of the same user (e.g. two logged-in devices) intentionally
// share one budget. The caller is resolved first, ahead of the limiter, by
// requireAuthMiddleware (notificationTestLimiter) or naturalQueryRateGate
// (naturalQueryLimiter); both settle an invalid caller before counting, so
// req.userId is set by the time this runs. The IP fallback is defensive
// only, unreachable while every mount keeps its resolver in front.
function perUserKey(req: Request): string {
  const userId = (req as Request & { userId?: string }).userId;
  return userId ? `user:${userId}` : ipKeyGenerator(req.ip ?? "unknown");
}

// Strict per-user limit for routes that trigger a real notification dispatch
// (currently just the subscription test-notify route). Configurable via env
// (NOTIFICATION_TEST_RATE_LIMIT_WINDOW_MS / _MAX); see docs/api.md.
const notificationTestLimiter = rateLimit({
  windowMs: config.notificationTestRateLimitWindowMs,
  limit: config.notificationTestRateLimitMax,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  keyGenerator: perUserKey,
  handler: rateLimitHandler(
    "Too many test notifications, try again later",
    config.notificationTestRateLimitWindowMs,
  ),
});

// Per-user limit for the LLM-backed natural-language query routes:
// POST /query/natural, POST /logs/search with queryType "natural" and
// GET /logs?queryType=natural. All three can reach the model
// (query-service.ts calls it only for queryType "natural"), so they share
// ONE bucket per user: a single rateLimit instance keyed by perUserKey, so
// rotating between the paths does not multiply the budget. SQL search
// (queryType absent or "sql") never enters the bucket and is never limited
// here. Configurable via env (NATURAL_QUERY_RATE_LIMIT_WINDOW_MS / _MAX);
// see docs/api.md.
const naturalQueryLimiter = rateLimit({
  windowMs: config.naturalQueryRateLimitWindowMs,
  limit: config.naturalQueryRateLimitMax,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  keyGenerator: perUserKey,
  handler: rateLimitHandler(
    "Too many natural-language queries, try again later",
    config.naturalQueryRateLimitWindowMs,
  ),
});

// Route-level gate for naturalQueryLimiter, mounted in front of the handler
// on each of the three routes. Those routes authenticate inside the handler
// (inline requireAuth), so the gate resolves the caller itself before
// counting: an unauthenticated or invalid request is passed through
// UNCOUNTED (the handler's requireAuth answers the 401), so it never
// creates a bucket, and a resolved caller gets req.userId set, so the
// limiter keys by perUserKey exactly like notificationTestLimiter. A
// request that is not a natural-language query is passed through before the
// auth lookup too, so SQL search neither pays for the lookup nor consumes
// the bucket. A counted caller whose request the handler later rejects (a
// body that fails schema validation, say) has already consumed the slot:
// rejecting over-limit natural requests before their schema check is
// deliberate, so 400-spam cannot be free (documented in docs/api.md). The
// handler resolves the caller a second time; the duplicate session lookup
// is accepted rather than restructuring the handler bodies (the
// notification-test route avoids it with requireAuthMiddleware because that
// route has no other auth shape).
function naturalQueryRateGate(isNatural: (req: Request) => boolean) {
  return async function naturalQueryRateLimited(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    if (!isNatural(req)) {
      next();
      return;
    }
    try {
      (req as Request & { userId?: string }).userId = await resolveUserId(req);
    } catch {
      next();
      return;
    }
    naturalQueryLimiter(req, res, next);
  };
}

// Always natural: POST /query/natural is a natural query by definition.
const naturalQueryAlwaysGate = naturalQueryRateGate(() => true);

// Counts POST /logs/search only when the raw body asks for queryType
// "natural" (the schema has no transform on queryType, so the raw value
// equals the parsed one; any other body reaches neither the auth lookup
// nor the bucket).
const naturalQueryBodyGate = naturalQueryRateGate((req) => {
  const body: unknown = req.body;
  return (
    typeof body === "object" &&
    body !== null &&
    !Array.isArray(body) &&
    (body as { queryType?: unknown }).queryType === "natural"
  );
});

// Counts GET /logs only with queryType=natural; a repeated or non-string
// value is not "natural" and the schema refuses it before any LLM call.
const naturalQueryQueryGate = naturalQueryRateGate((req) => req.query.queryType === "natural");

function parseToken(header?: string): string {
  if (!header) {
    throw new Error("Missing authorization header");
  }
  return header.replace(/^Bearer\s+/i, "");
}

function toIsoDate(value: Date): string {
  return value.toISOString();
}

function withDefaultSearchRange(input: unknown): unknown {
  if (!input || typeof input !== "object") {
    return input;
  }

  const payload = input as Record<string, unknown>;
  if (payload.startTime && payload.endTime) {
    return payload;
  }

  const now = new Date();
  const start = new Date(now.getTime() - DEFAULT_SEARCH_LOOKBACK_MS);

  return {
    ...payload,
    startTime: typeof payload.startTime === "string" ? payload.startTime : toIsoDate(start),
    endTime: typeof payload.endTime === "string" ? payload.endTime : toIsoDate(now),
  };
}

function enforceSearchLimits(input: {
  startTime?: string;
  endTime?: string;
  limit?: number;
  query?: string;
  queryType?: string;
}): string | null {
  if (typeof input.limit === "number" && input.limit > config.maxPageSize) {
    return `limit exceeds maximum of ${config.maxPageSize}`;
  }
  // The schema bounds the query's length, but every distinct token becomes its
  // own ILIKE group in the generated SQL, so a query at the length cap can
  // still carry a very large number of them. Reject past the token cap with the
  // same 400 shape as the limit errors instead of silently truncating; the
  // repository keeps a defensive cap for non-route callers. A "natural" query
  // is not tokenized into SQL (the AI planner's terms are capped by the
  // repository), so the cap applies to the sql query type only.
  if (
    (input.queryType ?? "sql") === "sql" &&
    typeof input.query === "string" &&
    searchQueryTokens(input.query).length > SEARCH_QUERY_MAX_TOKENS
  ) {
    return `query is limited to ${SEARCH_QUERY_MAX_TOKENS} search terms`;
  }
  if (input.startTime && input.endTime) {
    const start = new Date(input.startTime).getTime();
    const end = new Date(input.endTime).getTime();
    if (Number.isFinite(start) && Number.isFinite(end) && end >= start) {
      if (end - start > config.maxLookbackMs) {
        return `Time range cannot exceed 7 days. Please narrow your selection.`;
      }
    }
  }
  return null;
}

const SYNC_TIMEOUT = Symbol("sync-timeout");
type SyncBudgetOutcome<T> = { done: true; value: T } | { done: false; running: Promise<T> };
// A query that outlives the budget keeps running: the outcome hands that same
// promise back so a job can adopt it instead of starting a second query.
async function runWithSyncBudget<T>(producer: () => Promise<T>): Promise<SyncBudgetOutcome<T>> {
  const running = producer();
  const timeout = new Promise<typeof SYNC_TIMEOUT>((resolve) => {
    setTimeout(() => resolve(SYNC_TIMEOUT), config.maxSyncRuntimeMs);
  });
  const first = await Promise.race([running, timeout]);
  return first === SYNC_TIMEOUT ? { done: false, running } : { done: true, value: first };
}

// Seconds a client refused by the async job cap is told to wait before it
// retries: the Retry-After header and the body's retryAfter. A fixed small
// value, because the router cannot tell when a pending job of the team settles.
const ASYNC_JOB_RETRY_AFTER_SECONDS = 5;

function refuseAsyncJob(res: Response, refusal: AsyncJobCapError): void {
  res.setHeader("Retry-After", String(ASYNC_JOB_RETRY_AFTER_SECONDS));
  res.status(429).json({
    error:
      refusal.limit === "team"
        ? "Too many query jobs in flight for this team, try again shortly"
        : "The server is busy with query jobs, try again shortly",
    retryAfter: ASYNC_JOB_RETRY_AFTER_SECONDS,
  });
}

function answerAsyncJobStart<T>(res: Response, teamId: string, producer: () => Promise<T>): void {
  try {
    const start = queryService.startAsyncJob(teamId, producer);
    res.status(202).json({ ...start, status: "pending" });
  } catch (error) {
    if (!(error instanceof AsyncJobCapError)) throw error;
    refuseAsyncJob(res, error);
  }
}

// Shared by the facets, histogram and patterns routes. Every query counts
// against the job cap from the moment it starts: an explicit async request
// starts a job, a plain request takes a slot first and keeps it while it runs
// inside the sync budget. At the cap the request answers 429 before any query
// runs. A query that outlives the budget turns its slot into the job, which
// adopts the query already running.
async function answerSyncOrAsync<T extends object>(
  res: Response,
  teamId: string,
  asyncRequested: boolean,
  producer: () => Promise<T>,
): Promise<void> {
  if (asyncRequested) {
    answerAsyncJobStart(res, teamId, producer);
    return;
  }
  let slot: SyncSlot;
  try {
    slot = queryService.reserveSyncSlot(teamId);
  } catch (error) {
    if (!(error instanceof AsyncJobCapError)) throw error;
    refuseAsyncJob(res, error);
    return;
  }
  let outcome: SyncBudgetOutcome<T>;
  try {
    outcome = await runWithSyncBudget(producer);
  } catch (error) {
    slot.release();
    throw error;
  }
  if (!outcome.done) {
    const start = slot.convertToJob(outcome.running);
    res.status(202).json({ ...start, status: "pending" });
    return;
  }
  slot.release();
  res.json({ requestId: randomUUID(), partial: false, cached: false, ...outcome.value });
}

// 2.5 — API-Key authentication middleware for ingest endpoints
async function authenticateApiKey(req: Request, res: Response, next: NextFunction) {
  const apiKey = req.header("X-API-Key");
  if (!apiKey) {
    res.status(401).json({ error: "Missing X-API-Key header" });
    return;
  }

  const source = await prisma.logSource.findUnique({ where: { apiKey } });
  if (!source) {
    res.status(403).json({ error: "Invalid API key" });
    return;
  }

  // The API key resolves a single source/tenant. Reject if it does not match
  // the URL path source, otherwise any valid key could forge logs into another
  // source / team (cross-tenant log forgery). Applies to both
  // /ingest/:sourceId and /ingest/:sourceId/raw via this shared middleware.
  if (source.id !== String(req.params.sourceId)) {
    res.status(403).json({ error: "API key does not match source" });
    return;
  }

  // Attach source info for downstream use
  (req as Request & { logSource?: typeof source }).logSource = source;
  next();
}

// --- Routes ---

// SHA-256 digests are fixed-length, so timingSafeEqual cannot early-return on a
// length difference and the comparison time does not leak the token length.
function sha256Digest(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

// True when the request carries `Authorization: Bearer <METRICS_TOKEN>`,
// compared in constant time. False when METRICS_TOKEN is unset (no token to
// match). Shared by GET /health (the per-dependency detail) and GET /metrics
// (app.ts); the token is read from the header, so it never enters the URL or
// the access log.
export function hasValidMetricsToken(authorization: string | undefined): boolean {
  const expected = config.metricsToken;
  if (!expected) return false;
  const provided = /^Bearer (.+)$/i.exec(authorization ?? "")?.[1];
  if (!provided) return false;
  return timingSafeEqual(sha256Digest(provided), sha256Digest(expected));
}

apiRouter.get(
  "/health",
  asyncHandler(async (req, res) => {
    const checks: Record<string, "ok" | "error"> = {
      postgres: "error",
      clickhouse: "error",
      redis: "error",
    };

    try {
      await prisma.$queryRaw`SELECT 1`;
      checks.postgres = "ok";
    } catch {
      /* keep error */
    }
    try {
      const ch = await clickhouse.ping();
      if (ch.success) checks.clickhouse = "ok";
    } catch {
      /* keep error */
    }
    try {
      await redis.ping();
      checks.redis = "ok";
    } catch {
      /* keep error */
    }

    const healthy = Object.values(checks).every((v) => v === "ok");
    // The compose healthchecks, the relay deploy check and
    // scripts/clickhouse-config-guard.sh use only the status code, and the
    // docs tell operators to read `status`: those stay unauthenticated and
    // name no dependency. The per-dependency checks object (which dependency
    // is down) is for a caller holding METRICS_TOKEN, the same Bearer token
    // as GET /metrics.
    const body: { status: "ok" | "degraded"; checks?: typeof checks } = {
      status: healthy ? "ok" : "degraded",
    };
    if (hasValidMetricsToken(req.header("authorization"))) {
      body.checks = checks;
    }
    res.status(healthy ? 200 : 503).json(body);
  }),
);

apiRouter.post(
  "/auth/register",
  authLimiter,
  asyncHandler(async (req, res) => {
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    try {
      const result = await teamService.register(parsed.data.email, parsed.data.password, parsed.data.name);
      res.status(201).json(result);
    } catch (error) {
      log.warn({ email: parsed.data.email }, "Registration failed");
      res.status(400).json({ error: error instanceof Error ? error.message : "Register failed" });
    }
  }),
);

apiRouter.get(
  "/auth/settings",
  asyncHandler(async (_req, res) => {
    res.json({ registrationMode: config.registrationMode });
  }),
);

apiRouter.post(
  "/auth/login",
  authLimiter,
  asyncHandler(async (req, res) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    try {
      const result = await teamService.login(parsed.data.email, parsed.data.password);
      res.json(result);
    } catch (error) {
      res.status(401).json({ error: error instanceof Error ? error.message : "Login failed" });
    }
  }),
);

// The caller as the server knows them. The frontend reads its authorization
// decisions (the admin pages) from here; the `telerithm_user` cookie it keeps
// for display is client-writable and never trusted.
apiRouter.get(
  "/auth/me",
  asyncHandler(async (req, res) => {
    const userId = await requireAuth(req, res);
    if (userId === null) return;
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, name: true, role: true, status: true },
    });
    if (!user) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    res.set("Cache-Control", "no-store");
    res.json({ user });
  }),
);

// Ends the presented session only: other sessions of the same user (another
// device) stay valid. Without a live token it answers 401 like every
// authenticated route.
apiRouter.post(
  "/auth/logout",
  asyncHandler(async (req, res) => {
    if ((await requireAuth(req, res)) === null) return;
    await prisma.session.deleteMany({ where: { token: parseToken(req.header("authorization")) } });
    res.status(204).end();
  }),
);

apiRouter.get(
  "/teams",
  asyncHandler(async (req, res) => {
    const userId = await requireAuth(req, res);
    if (userId === null) return;
    const teams = await teamService.listTeamsForUser(userId);
    res.json({ teams });
  }),
);

apiRouter.post(
  "/teams",
  asyncHandler(async (req, res) => {
    if ((await requireAuth(req, res)) === null) return;
    const parsed = createTeamSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    // Auth is already verified above; any error from createTeam is a
    // business-rule failure (single-tenant mode disabled, slug taken,
    // etc.), so 400 fits rather than 401.
    try {
      const team = await teamService.createTeam(
        parseToken(req.header("authorization")),
        parsed.data.name,
        parsed.data.slug,
      );
      res.status(201).json({ team });
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : "Failed" });
    }
  }),
);

apiRouter.get(
  "/sources",
  asyncHandler(async (req, res) => {
    const userId = await requireAuth(req, res);
    if (userId === null) return;
    const teamId = String(req.query.teamId ?? "");
    if (!teamId) {
      res.status(400).json({ error: "teamId is required" });
      return;
    }
    const role = await requireTeamRole(userId, teamId, res);
    if (role === null) return;
    const sources = await teamService.listSources(teamId, {
      keyView: canSeeSourceKeys(role) ? "hint" : "none",
    });
    res.json({ sources });
  }),
);

// The response carries the full ingest key once, so it is never cached.
writeRoute("post", "/sources", teamFromBody(createSourceSchema), async ({ res, input }) => {
  res.set("Cache-Control", "no-store");
  const source = await teamService.createSource(input.teamId, input.name, input.type);
  res.status(201).json({ source });
});

// Resolve a source's team; writeRoute then requires write-capable membership on
// it (VIEWER 403, a non-member the same 404 as an unknown id). The loader only
// reads (see teamFromResource in write-route.ts).
const loadSourceTeamId = (sourceId: string) =>
  prisma.logSource
    .findUnique({ where: { id: sourceId }, select: { teamId: true } })
    .then((source) => source?.teamId ?? null);

writeRoute(
  "put",
  "/sources/:id",
  teamFromResource(loadSourceTeamId, "Source not found", renameSourceSchema),
  async ({ req, res, teamId, role, input }) => {
    try {
      const source = await teamService.renameSource(teamId, String(req.params.id), input.name, {
        keyView: canSeeSourceKeys(role) ? "hint" : "none",
      });
      res.json({ source });
    } catch (error) {
      if (handlePrismaError(error, res, { notFound: "Source not found" })) return;
      throw error;
    }
  },
);

// Delete and key rotation are narrower than rename: OWNER and ADMIN only, the
// same rule as seeing the keys (canManageSources). writeRoute has already
// refused a VIEWER and a non-member by then; a MEMBER passes the write gate, so
// the handler answers 403 before any service call.
//
// Delete removes the LogSource row only. Ingest looks the key up on that table
// (authenticateApiKey), so the key is rejected at once; stored logs stay in
// ClickHouse until the table TTL and no ClickHouse call is made here.
writeRoute(
  "delete",
  "/sources/:id",
  teamFromResource(loadSourceTeamId, "Source not found"),
  async ({ req, res, teamId, role }) => {
    if (!canManageSources(role)) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    try {
      await teamService.deleteSource(teamId, String(req.params.id));
      res.status(204).end();
    } catch (error) {
      if (handlePrismaError(error, res, { notFound: "Source not found" })) return;
      throw error;
    }
  },
);

// Hard cutover: the new key replaces the old one in place, so the next ingest
// request with the old key is a 403. The response is the only place the new
// key is returned to this caller besides the audited reveal below. Like the
// reveal, every answer of the handler is marked no-store.
writeRoute(
  "post",
  "/sources/:id/rotate-key",
  teamFromResource(loadSourceTeamId, "Source not found"),
  async ({ req, res, teamId, role }) => {
    res.set("Cache-Control", "no-store");
    if (!canManageSources(role)) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    try {
      const source = await teamService.rotateSourceKey(teamId, String(req.params.id));
      res.json({ source });
    } catch (error) {
      if (handlePrismaError(error, res, { notFound: "Source not found" })) return;
      throw error;
    }
  },
);

// The only read path to a stored ingest key: lists and renames carry the
// masked hint, never the key. OWNER and ADMIN only (canSeeSourceKeys); writeRoute
// has already refused a VIEWER and answered a non-member of the owning team
// like an unknown id, and a MEMBER passes the write gate, so the handler
// answers 403 before the key is read. No answer of the handler is cached, error
// answers included (the header is set before anything else). Every
// successful reveal leaves one audit line with who looked at which source; the
// line never carries the key.
writeRoute(
  "post",
  "/sources/:id/reveal",
  teamFromResource(loadSourceTeamId, "Source not found"),
  async ({ req, res, userId, teamId, role }) => {
    res.set("Cache-Control", "no-store");
    if (!canSeeSourceKeys(role)) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    const sourceId = String(req.params.id);
    const apiKey = await teamService.revealSourceKey(teamId, sourceId);
    if (apiKey === null) {
      res.status(404).json({ error: "Source not found" });
      return;
    }
    log.info({ sourceId, teamId, userId }, "Source key revealed");
    res.json({ apiKey });
  },
);

// 2.5 — Ingest with API-Key auth + rate limit + sanitization
apiRouter.post(
  "/ingest/:sourceId",
  ingestLimiter,
  authenticateApiKey,
  asyncHandler(async (req, res) => {
    // Forwarders such as Fluentd (out_http, json_array) and Vector (http sink,
    // json codec) can only post a bare JSON array of events, so treat an array
    // body as the `logs` list of the documented envelope.
    const body = Array.isArray(req.body) ? { logs: req.body } : req.body;
    const parsed = ingestSchema.safeParse(body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }

    try {
      const response = await ingestionService.ingest(String(req.params.sourceId), parsed.data);
      res.status(202).json(response);
    } catch (error) {
      if (error instanceof IngestBatchTooLargeError) {
        res.status(413).json({ error: error.message });
        return;
      }
      res.status(404).json({ error: error instanceof Error ? error.message : "Ingest failed" });
    }
  }),
);

// Raw text ingest: one log line per line. The body must be sent as text
// (Content-Type: text/plain). express.text parses only text/* bodies; any other
// type leaves req.body as the JSON parser's result or `{}`, which the handler
// answers with 415 instead of ingesting a stringified object. The parser sits
// after the API-key check, so a text body is only read for a valid source.
const rawIngestBodyParser = express.text({ type: "text/*", limit: "10mb" });

apiRouter.post(
  "/ingest/:sourceId/raw",
  ingestLimiter,
  authenticateApiKey,
  rawIngestBodyParser,
  asyncHandler(async (req, res) => {
    if (typeof req.body !== "string") {
      // req.is() is null when the request has no body at all, false when it
      // has one of a type the text parser skipped.
      if (req.is("text/*") === false) {
        res.status(415).json({ error: "Content-Type must be text/plain" });
        return;
      }
      res.status(400).json({ error: "Empty body" });
      return;
    }
    const lines = req.body.split(/\r?\n/).filter((l: string) => l.trim().length > 0);
    if (lines.length === 0) {
      res.status(400).json({ error: "Empty body" });
      return;
    }
    // The raw route skips ingestSchema, so bound the entry count (one line,
    // one entry) against the same cap here; 413 with the same body the JSON
    // route sends when the service rejects an oversized parsed batch.
    if (lines.length > MAX_INGEST_BATCH) {
      res.status(413).json({ error: new IngestBatchTooLargeError(MAX_INGEST_BATCH).message });
      return;
    }
    const payload = { logs: lines };
    try {
      const response = await ingestionService.ingest(String(req.params.sourceId), payload);
      res.status(202).json(response);
    } catch (error) {
      // A line that holds a JSON array expands past the cap in the service.
      if (error instanceof IngestBatchTooLargeError) {
        res.status(413).json({ error: error.message });
        return;
      }
      res.status(404).json({ error: error instanceof Error ? error.message : "Ingest failed" });
    }
  }),
);

apiRouter.post(
  "/logs/search",
  naturalQueryBodyGate,
  asyncHandler(async (req, res) => {
    const userId = await requireAuth(req, res);
    if (userId === null) return;
    const parsed = searchSchema.safeParse(withDefaultSearchRange(req.body));
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    if ((await requireTeamRole(userId, parsed.data.teamId, res)) === null) return;
    const limitError = enforceSearchLimits(parsed.data);
    if (limitError) {
      res.status(400).json({ error: limitError });
      return;
    }
    const result = await queryService.search(parsed.data);
    res.json(result);
  }),
);

apiRouter.get(
  "/logs",
  naturalQueryQueryGate,
  asyncHandler(async (req, res) => {
    const userId = await requireAuth(req, res);
    if (userId === null) return;
    const parsed = searchSchema.safeParse(
      withDefaultSearchRange({
        teamId: req.query.teamId,
        sourceId: req.query.sourceId,
        startTime: req.query.startTime,
        endTime: req.query.endTime,
        query: req.query.query,
        queryType: req.query.queryType ?? "sql",
        limit: req.query.limit ? Number(req.query.limit) : 100,
        offset: req.query.offset ? Number(req.query.offset) : 0,
        pageToken: req.query.pageToken,
      }),
    );
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    if ((await requireTeamRole(userId, parsed.data.teamId, res)) === null) return;
    const limitError = enforceSearchLimits(parsed.data);
    if (limitError) {
      res.status(400).json({ error: limitError });
      return;
    }
    const result = await queryService.search(parsed.data);
    res.json(result);
  }),
);

apiRouter.post(
  "/logs/context",
  asyncHandler(async (req, res) => {
    const userId = await requireAuth(req, res);
    if (userId === null) return;
    const parsed = contextSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    if ((await requireTeamRole(userId, parsed.data.teamId, res)) === null) return;
    const result = await queryService.getContext(parsed.data);
    res.json(result);
  }),
);

apiRouter.post(
  "/logs/facets",
  asyncHandler(async (req, res) => {
    const userId = await requireAuth(req, res);
    if (userId === null) return;
    const parsed = facetsSchema.safeParse(withDefaultSearchRange(req.body));
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    if ((await requireTeamRole(userId, parsed.data.teamId, res)) === null) return;
    const limitError = enforceSearchLimits(parsed.data);
    if (limitError) {
      res.status(400).json({ error: limitError });
      return;
    }
    await answerSyncOrAsync(res, parsed.data.teamId, parsed.data.async, () =>
      queryService.getFacets({ ...parsed.data, async: undefined }),
    );
  }),
);

apiRouter.post(
  "/logs/histogram",
  asyncHandler(async (req, res) => {
    const userId = await requireAuth(req, res);
    if (userId === null) return;
    const parsed = histogramSchema.safeParse(withDefaultSearchRange(req.body));
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    if ((await requireTeamRole(userId, parsed.data.teamId, res)) === null) return;
    const limitError = enforceSearchLimits(parsed.data);
    if (limitError) {
      res.status(400).json({ error: limitError });
      return;
    }
    await answerSyncOrAsync(res, parsed.data.teamId, parsed.data.async, () =>
      queryService.getHistogram({ ...parsed.data, async: undefined }),
    );
  }),
);

apiRouter.post(
  "/logs/patterns",
  asyncHandler(async (req, res) => {
    const userId = await requireAuth(req, res);
    if (userId === null) return;
    const parsed = patternsSchema.safeParse(withDefaultSearchRange(req.body));
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    if ((await requireTeamRole(userId, parsed.data.teamId, res)) === null) return;
    const limitError = enforceSearchLimits(parsed.data);
    if (limitError) {
      res.status(400).json({ error: limitError });
      return;
    }
    await answerSyncOrAsync(res, parsed.data.teamId, parsed.data.async, () =>
      queryService.getPatterns({ ...parsed.data, async: undefined }),
    );
  }),
);

apiRouter.get(
  "/query/jobs/:id",
  asyncHandler(async (req, res) => {
    const userId = await requireAuth(req, res);
    if (userId === null) return;
    const job = queryService.getAsyncJob(String(req.params.id));
    if (!job) {
      res.status(404).json({ error: "Job not found" });
      return;
    }
    // The payload is team-scoped log data, so authorize against the job's own
    // team before handing it out: requireAuth alone let any authenticated user
    // read another team's query results (IDOR).
    // A job of another team answers like an unknown id.
    if ((await requireTeamRole(userId, job.teamId, res, "Job not found")) === null) return;
    // Project only the public fields; teamId is an internal authz attribute.
    res.json({
      requestId: job.requestId,
      status: job.status,
      data: job.data,
      error: job.error,
    });
  }),
);

// True when a create or update payload touches team-wide view state.
function requestsSharedState(input: { isShared?: boolean; isDefault?: boolean }): boolean {
  return input.isShared === true || input.isDefault === true;
}

apiRouter.get(
  "/logs/views",
  asyncHandler(async (req, res) => {
    const userId = await requireAuth(req, res);
    if (userId === null) return;
    const teamId = String(req.query.teamId ?? "");
    if (!teamId) {
      res.status(400).json({ error: "teamId is required" });
      return;
    }
    if ((await requireTeamRole(userId, teamId, res)) === null) return;
    const views = await logViewService.list(teamId, userId);
    res.json({ views });
  }),
);

apiRouter.post(
  "/logs/views",
  asyncHandler(async (req, res) => {
    const userId = await requireAuth(req, res);
    if (userId === null) return;
    const parsed = createSavedViewSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    const role = await requireTeamRole(userId, parsed.data.teamId, res);
    if (role === null) return;
    if (requestsSharedState(parsed.data) && !canManageShared(role)) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    const view = await logViewService.create({
      teamId: parsed.data.teamId,
      userId,
      name: parsed.data.name,
      isShared: parsed.data.isShared,
      isDefault: parsed.data.isDefault,
      definition: parsed.data.definition,
    });
    res.status(201).json({ view });
  }),
);

apiRouter.put(
  "/logs/views/:id",
  asyncHandler(async (req, res) => {
    const userId = await requireAuth(req, res);
    if (userId === null) return;
    const teamId = String(req.query.teamId ?? req.body?.teamId ?? "");
    if (!teamId) {
      res.status(400).json({ error: "teamId is required" });
      return;
    }
    const parsed = updateSavedViewSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    const role = await requireTeamRole(userId, teamId, res);
    if (role === null) return;
    if (requestsSharedState(parsed.data) && !canManageShared(role)) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    try {
      const view = await logViewService.update(String(req.params.id), {
        teamId,
        userId,
        canManageShared: canManageShared(role),
        ...parsed.data,
      });
      res.json({ view });
    } catch (error) {
      if (handleServiceError(error, res)) return;
      throw error;
    }
  }),
);

apiRouter.post(
  "/logs/views/:id/duplicate",
  asyncHandler(async (req, res) => {
    const userId = await requireAuth(req, res);
    if (userId === null) return;
    const teamId = String(req.body?.teamId ?? "");
    if (!teamId) {
      res.status(400).json({ error: "teamId is required" });
      return;
    }
    const name = typeof req.body?.name === "string" ? req.body.name : undefined;
    const role = await requireTeamRole(userId, teamId, res);
    if (role === null) return;
    try {
      const view = await logViewService.duplicate(String(req.params.id), {
        teamId,
        userId,
        canManageShared: canManageShared(role),
        name,
      });
      res.status(201).json({ view });
    } catch (error) {
      if (handleServiceError(error, res)) return;
      throw error;
    }
  }),
);

apiRouter.delete(
  "/logs/views/:id",
  asyncHandler(async (req, res) => {
    const userId = await requireAuth(req, res);
    if (userId === null) return;
    const teamId = String(req.query.teamId ?? "");
    if (!teamId) {
      res.status(400).json({ error: "teamId is required" });
      return;
    }
    const role = await requireTeamRole(userId, teamId, res);
    if (role === null) return;
    try {
      await logViewService.remove(String(req.params.id), {
        teamId,
        userId,
        canManageShared: canManageShared(role),
      });
      res.status(204).end();
    } catch (error) {
      if (handleServiceError(error, res)) return;
      throw error;
    }
  }),
);

apiRouter.get(
  "/logs/:id",
  asyncHandler(async (req, res) => {
    const userId = await requireAuth(req, res);
    if (userId === null) return;
    const teamId = String(Array.isArray(req.query.teamId) ? req.query.teamId[0] : (req.query.teamId ?? ""));
    const logId = String(req.params.id ?? "");
    if (!teamId || !logId) {
      res.status(400).json({ error: "teamId and id are required" });
      return;
    }
    if ((await requireTeamRole(userId, teamId, res)) === null) return;
    const log = await logRepository.findById(teamId, logId);
    if (!log) {
      res.status(404).json({ error: "Log not found" });
      return;
    }
    res.json({ log });
  }),
);

apiRouter.post(
  "/query/natural",
  naturalQueryAlwaysGate,
  asyncHandler(async (req, res) => {
    const userId = await requireAuth(req, res);
    if (userId === null) return;
    const parsed = naturalQuerySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    if ((await requireTeamRole(userId, parsed.data.teamId, res)) === null) return;
    const result = await queryService.explainNaturalQuery(parsed.data.teamId, parsed.data.query);
    res.json(result);
  }),
);

apiRouter.get(
  "/alerts/rules",
  asyncHandler(async (req, res) => {
    const userId = await requireAuth(req, res);
    if (userId === null) return;
    const teamId = String(req.query.teamId ?? "");
    if (!teamId) {
      res.status(400).json({ error: "teamId is required" });
      return;
    }
    if ((await requireTeamRole(userId, teamId, res)) === null) return;
    const rules = await alertService.listRules(teamId);
    res.json({ rules });
  }),
);

apiRouter.get(
  "/alerts/incidents",
  asyncHandler(async (req, res) => {
    const userId = await requireAuth(req, res);
    if (userId === null) return;
    const teamId = String(req.query.teamId ?? "");
    if (!teamId) {
      res.status(400).json({ error: "teamId is required" });
      return;
    }
    if ((await requireTeamRole(userId, teamId, res)) === null) return;
    const incidents = await alertService.listIncidents(teamId);
    res.json({ incidents });
  }),
);

// --- Mute / Unmute ---

// Resolve an alert rule's team; writeRoute then requires the caller's
// membership on it with a write-capable role, otherwise any authenticated user
// could mute another team's rule by enumerating its id and silence their
// alerting (cross-tenant IDOR), and a read-only VIEWER could silence its own
// team's. The loader only reads (see teamFromResource in write-route.ts).
const loadRuleTeamId = (ruleId: string) =>
  prisma.alertRule
    .findUnique({ where: { id: ruleId }, select: { teamId: true } })
    .then((rule) => rule?.teamId ?? null);

writeRoute(
  "post",
  "/alerts/rules/:id/mute",
  teamFromResource(loadRuleTeamId, "Alert rule not found", muteRuleSchema),
  async ({ req, res, teamId, input }) => {
    const muteUntil = new Date(Date.now() + input.durationMinutes * 60_000);
    try {
      const rule = await prisma.alertRule.update({
        where: { id: String(req.params.id), teamId },
        data: { muteUntil },
      });
      res.json({ rule: { id: rule.id, muteUntil: rule.muteUntil } });
    } catch (error) {
      if (handlePrismaError(error, res, { notFound: "Alert rule not found" })) return;
      throw error;
    }
  },
);

writeRoute(
  "post",
  "/alerts/rules/:id/unmute",
  teamFromResource(loadRuleTeamId, "Alert rule not found"),
  async ({ req, res, teamId }) => {
    try {
      const rule = await prisma.alertRule.update({
        where: { id: String(req.params.id), teamId },
        data: { muteUntil: null },
      });
      res.json({ rule: { id: rule.id, muteUntil: null } });
    } catch (error) {
      if (handlePrismaError(error, res, { notFound: "Alert rule not found" })) return;
      throw error;
    }
  },
);

// --- Alert rule create, edit, delete ---

// The team of a new rule comes from the body; PUT and DELETE take it from the
// stored rule (loadRuleTeamId above), and the service scopes the write by
// {id, teamId} again. A VIEWER gets 403 from writeRoute before any handler runs.
// At config.alertRulesMaxPerTeam rules for the team, createRule throws a
// ConflictError and the route answers 409 naming the cap; below it, 201.
writeRoute("post", "/alerts/rules", teamFromBody(createAlertRuleSchema), async ({ res, teamId, input }) => {
  try {
    const rule = await alertService.createRule(teamId, input);
    res.status(201).json({ rule });
  } catch (error) {
    if (handleServiceError(error, res)) return;
    throw error;
  }
});

writeRoute(
  "put",
  "/alerts/rules/:id",
  teamFromResource(loadRuleTeamId, "Alert rule not found", updateAlertRuleSchema),
  async ({ req, res, teamId, input }) => {
    try {
      const rule = await alertService.updateRule(String(req.params.id), teamId, input);
      res.json({ rule });
    } catch (error) {
      if (handleServiceError(error, res)) return;
      throw error;
    }
  },
);

writeRoute(
  "delete",
  "/alerts/rules/:id",
  teamFromResource(loadRuleTeamId, "Alert rule not found"),
  async ({ req, res, teamId }) => {
    try {
      await alertService.deleteRule(String(req.params.id), teamId);
      res.status(204).end();
    } catch (error) {
      if (handleServiceError(error, res)) return;
      throw error;
    }
  },
);

// --- Maintenance Windows ---

apiRouter.get(
  "/maintenance-windows",
  asyncHandler(async (req, res) => {
    const userId = await requireAuth(req, res);
    if (userId === null) return;
    const teamId = String(req.query.teamId ?? "");
    if (!teamId) {
      res.status(400).json({ error: "teamId is required" });
      return;
    }
    if ((await requireTeamRole(userId, teamId, res)) === null) return;
    const windows = await prisma.maintenanceWindow.findMany({
      where: { teamId },
      orderBy: { startsAt: "desc" },
      take: 20,
    });
    res.json({ windows });
  }),
);

writeRoute("post", "/maintenance-windows", teamFromBody(maintenanceWindowSchema), async ({ res, input }) => {
  try {
    const window = await prisma.maintenanceWindow.create({
      data: {
        teamId: input.teamId,
        name: input.name,
        startsAt: new Date(input.startsAt),
        endsAt: new Date(input.endsAt),
      },
    });
    res.status(201).json({ window });
  } catch (error) {
    if (handlePrismaError(error, res, { conflict: "Maintenance window already exists" })) return;
    throw error;
  }
});

// Resolve a maintenance window's team; writeRoute then requires the caller's
// membership on it with a write-capable role, otherwise any authenticated user
// could delete another team's window by enumerating its id, re-arming that
// team's alerting mid-maintenance (cross-tenant IDOR).
const loadMaintenanceWindowTeamId = (windowId: string) =>
  prisma.maintenanceWindow
    .findUnique({ where: { id: windowId }, select: { teamId: true } })
    .then((window) => window?.teamId ?? null);

writeRoute(
  "delete",
  "/maintenance-windows/:id",
  teamFromResource(loadMaintenanceWindowTeamId, "Maintenance window not found"),
  async ({ req, res, teamId }) => {
    const windowId = String(req.params.id);
    try {
      await prisma.maintenanceWindow.delete({ where: { id: windowId, teamId } });
      res.status(204).end();
    } catch (error) {
      if (handlePrismaError(error, res, { notFound: "Maintenance window not found" })) return;
      throw error;
    }
  },
);

apiRouter.get(
  "/dashboards/overview",
  asyncHandler(async (req, res) => {
    const userId = await requireAuth(req, res);
    if (userId === null) return;
    const teamId = String(req.query.teamId ?? "");
    if (!teamId) {
      res.status(400).json({ error: "teamId is required" });
      return;
    }
    if ((await requireTeamRole(userId, teamId, res)) === null) return;
    const overview = await dashboardService.getOverview(teamId);
    res.json({ overview });
  }),
);

// --- Incident Actions ---

async function resolveSession(req: Request) {
  const header = req.header("authorization");
  const token = parseToken(header);
  const session = await findActiveSession(token);
  if (!session) {
    throw new Error("Unauthorized");
  }
  return session;
}

async function resolveUserId(req: Request): Promise<string> {
  return (await resolveSession(req)).userId;
}

// Who opened a log stream and how the open stream keeps being checked.
interface StreamAuth {
  userId: string;
  // Set when the stream was opened with a ticket: the one team it was issued for.
  ticketTeamId?: string;
  // The heartbeat re-check (session, user status, team membership).
  recheck: (teamId: string) => Promise<boolean>;
}

// SSE-only auth: the Authorization header, or a one-time `?ticket=` from
// POST /stream/ticket, because `EventSource` cannot set headers. The session
// token is never accepted in the URL (it would reach proxy and access logs and
// the browser history); a ticket is single-use and lives 60 seconds. Only
// mounted on /stream/logs; every other route stays header-only via
// resolveUserId. When both are sent the header wins and the ticket is not
// consumed. Resolves null for a definite "no" (unknown, expired or used
// ticket, ticket of another session, dead session); the answer is the same
// for all of them.
async function resolveStreamAuth(req: Request): Promise<StreamAuth | null> {
  const header = req.header("authorization");
  if (header) {
    const token = header.replace(/^Bearer\s+/i, "");
    const session = await findActiveSession(token);
    if (!session) {
      return null;
    }
    const userId = session.userId;
    return { userId, recheck: (teamId) => isSessionAuthorizedForTeam(token, userId, teamId) };
  }
  const ticket = typeof req.query.ticket === "string" ? req.query.ticket : "";
  const grant = await consumeStreamTicket(redis, ticket);
  if (!grant) {
    return null;
  }
  const session = await findActiveSessionById(grant.sessionId);
  if (!session || session.userId !== grant.userId) {
    return null;
  }
  return {
    userId: grant.userId,
    ticketTeamId: grant.teamId,
    recheck: (teamId) => isSessionIdAuthorizedForTeam(grant.sessionId, grant.userId, teamId),
  };
}

async function requireStreamAuth(req: Request, res: Response): Promise<StreamAuth | null> {
  try {
    const auth = await resolveStreamAuth(req);
    if (auth) {
      return auth;
    }
  } catch (error) {
    log.warn({ err: error instanceof Error ? error.message : String(error) }, "Stream auth lookup failed");
  }
  res.status(401).json({ error: "Unauthorized" });
  return null;
}

// Bearer-token auth gate. Returns the userId on success, or sends a 401
// and returns null so the handler can early-return. Keeps the try/catch
// narrowed to the auth check, so any error thrown inside the handler body
// flows to the async error middleware as a 5xx rather than being masked
// as a 401.
async function requireAuth(req: Request, res: Response): Promise<string | null> {
  try {
    return await resolveUserId(req);
  } catch {
    res.status(401).json({ error: "Unauthorized" });
    return null;
  }
}

// requireAuth for a route that needs the session itself (its id), not just the
// user: same 401 contract.
async function requireAuthSession(req: Request, res: Response) {
  try {
    return await resolveSession(req);
  } catch {
    res.status(401).json({ error: "Unauthorized" });
    return null;
  }
}

// Thrown by resolveTeamRole when the lookup succeeded and found no membership.
// requireTeamRole maps exactly this error to a 403/404; any other error from
// the lookup (a database failure, say) is not a "not a member" answer and
// propagates to the error middleware as a 500.
class NotTeamMemberError extends Error {
  constructor() {
    super("Forbidden");
    this.name = "NotTeamMemberError";
  }
}

async function resolveTeamRole(
  userId: string,
  teamId: string,
): Promise<"OWNER" | "ADMIN" | "MEMBER" | "VIEWER"> {
  const membership = await prisma.teamMember.findUnique({
    where: { teamId_userId: { teamId, userId } },
  });
  if (!membership) {
    throw new NotTeamMemberError();
  }
  return membership.role as "OWNER" | "ADMIN" | "MEMBER" | "VIEWER";
}

// Team-membership gate, mirrored on requireAuth: returns the role on
// success, or sends a 403 and returns null. Used after requireAuth so
// non-member callers get a Forbidden response instead of a 500 from the
// async error middleware. With `nonMemberNotFound` a non-member gets 404 with
// that message instead: the by-id routes pass their resolver's not-found
// message so a resource of another team answers like an unknown id. Only the
// resolver's not-a-member outcome takes either branch; a failing lookup is
// rethrown so it surfaces as a 500, never as a false "not found" or "forbidden".
async function requireTeamRole(
  userId: string,
  teamId: string,
  res: Response,
  nonMemberNotFound?: string,
): Promise<"OWNER" | "ADMIN" | "MEMBER" | "VIEWER" | null> {
  try {
    return await resolveTeamRole(userId, teamId);
  } catch (error) {
    if (!(error instanceof NotTeamMemberError)) throw error;
    if (nonMemberNotFound !== undefined) {
      res.status(404).json({ error: nonMemberNotFound });
    } else {
      res.status(403).json({ error: "Forbidden" });
    }
    return null;
  }
}

// The single place that decides which team roles may mutate team-scoped data:
// OWNER, ADMIN and MEMBER write, VIEWER is read-only. Written as an allow
// list so a role added later is read-only until someone opts it in here.
// Every team-scoped write route reaches this predicate through
// requireTeamWriteRole, which the writeRoute wrapper (write-route.ts) applies
// before any handler runs; tests/unit/router-write-role.test.ts enforces that
// every state-changing route is either registered through writeRoute or a
// justified allowlist entry. Exported only so the tests can pin its truth
// table.
export function canWrite(role: TeamRoleName): boolean {
  return role === "OWNER" || role === "ADMIN" || role === "MEMBER";
}

// Who may see anything of a source's ingest key (the credential senders
// authenticate with): OWNER and ADMIN only, the masked hint in list and rename
// responses and the full key through POST /sources/:id/reveal. Written as an
// allow list so a role added later cannot see keys until someone opts it in
// here. A MEMBER who creates a source still gets the key once in the create
// response, because a new source is unusable without it.
export function canSeeSourceKeys(role: TeamRoleName): boolean {
  return role === "OWNER" || role === "ADMIN";
}

// Who may delete a source or rotate its ingest key: OWNER and ADMIN only, the
// same allow list as canSeeSourceKeys (rotating hands out a new credential,
// deleting is irreversible). Kept as its own predicate so the two rules can
// diverge without touching each other.
export function canManageSources(role: TeamRoleName): boolean {
  return role === "OWNER" || role === "ADMIN";
}

// Write-gate counterpart of requireTeamRole: the caller must be a member of
// the team AND hold a role that canWrite. Sends 403 and returns null for a
// non-member (via requireTeamRole) or for a read-only role, so the handler
// can early-return before any mutation; `nonMemberNotFound` turns the
// non-member answer into a 404 (see requireTeamRole), a read-only member
// still gets 403. Read paths keep using requireTeamRole.
async function requireTeamWriteRole(
  userId: string,
  teamId: string,
  res: Response,
  nonMemberNotFound?: string,
): Promise<TeamRoleName | null> {
  const role = await requireTeamRole(userId, teamId, res, nonMemberNotFound);
  if (role === null) return null;
  if (!canWrite(role)) {
    res.status(403).json({ error: "Forbidden" });
    return null;
  }
  return role;
}

// Membership-only resolver for by-id READ routes: loads a resource by id,
// derives its owning team via `loadTeamId`, and requires the caller's
// membership on that team (404 when the resource does not exist, and the same
// 404 for a non-member, so the status does not reveal that an id exists in
// another team). Without the team check any authenticated user could read
// another team's resource by enumerating its id (cross-tenant IDOR; the bug
// class fixed across four PRs on 2026-07-12: #97 invites, #98 incident
// actions/timeline, #100 alert-rule mute/unmute, #101 maintenance-window
// delete). Returns the teamId on success, or null once a 404/403 has already
// been sent.
//
// This is deliberately not a write gate: it checks membership only, so a
// VIEWER passes. A mutating route cannot use it to skip the write rule,
// because every state-changing route must be registered through writeRoute
// (teamFromResource resolves the team there, the wrapper applies the write
// gate) or be a justified allowlist entry; tests/unit/router-write-role.test.ts
// fails on anything else, and tests/unit/router-team-scoping.test.ts covers the
// by-id team-resolution half.
function requireResourceTeam(
  loadTeamId: (id: string) => Promise<string | null>,
  notFoundMessage: string,
): (id: string, userId: string, res: Response) => Promise<string | null> {
  return async (id, userId, res) => {
    const teamId = await loadTeamId(id);
    if (teamId === null) {
      res.status(404).json({ error: notFoundMessage });
      return null;
    }
    const role = await requireTeamRole(userId, teamId, res, notFoundMessage);
    if (role === null) return null;
    return teamId;
  };
}

// Maps a Prisma known-request error to an HTTP response:
//   P2025 (record not found)  -> 404
//   P2002 (unique constraint) -> 409
// Returns true (and sends the response) when the error is one of these so the
// caller can `return`; otherwise returns false so the caller rethrows and the
// central error middleware turns it into a 500. Structural check so we don't
// import the Prisma error class here (a runtime class, not a value-only type).
function handlePrismaError(
  error: unknown,
  res: Response,
  messages: { notFound?: string; conflict?: string } = {},
): boolean {
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = (error as { code?: unknown }).code;
    if (code === "P2025") {
      res.status(404).json({ error: messages.notFound ?? "Not found" });
      return true;
    }
    if (code === "P2002") {
      res.status(409).json({ error: messages.conflict ?? "Conflict" });
      return true;
    }
  }
  return false;
}

// Maps typed service-layer errors (NotFoundError/ForbiddenError/ConflictError) to an HTTP
// response, mirroring handlePrismaError's return-true-if-handled contract so
// callers can `return` on a hit or rethrow (and fall through to the central
// error middleware) on a miss.
function handleServiceError(error: unknown, res: Response): boolean {
  if (error instanceof NotFoundError) {
    res.status(404).json({ error: error.message });
    return true;
  }
  if (error instanceof ForbiddenError) {
    res.status(403).json({ error: error.message });
    return true;
  }
  if (error instanceof ConflictError) {
    res.status(409).json({ error: error.message });
    return true;
  }
  return false;
}

// Resolve an incident's team (via its rule), otherwise any authenticated user
// could mutate or read any incident by enumerating its id (cross-tenant
// IDOR). The acknowledge/resolve/reopen writes go through writeRoute, which
// adds the write gate; the timeline keeps a membership-only resolver
// (requireResourceTeam) so a VIEWER can still read it.
const loadIncidentTeamId = (incidentId: string) =>
  prisma.alertIncident
    .findUnique({ where: { id: incidentId }, select: { rule: { select: { teamId: true } } } })
    .then((incident) => incident?.rule.teamId ?? null);
const requireIncidentTeam = requireResourceTeam(loadIncidentTeamId, "Incident not found");
const incidentTeam = teamFromResource(loadIncidentTeamId, "Incident not found");

// The actions below reject a transition the incident's current status does not
// allow with 409 (ConflictError from AlertService); see INCIDENT_TRANSITIONS.
writeRoute(
  "post",
  "/alerts/incidents/:id/acknowledge",
  incidentTeam,
  async ({ req, res, userId, teamId }) => {
    const parsed = incidentActionSchema.safeParse(req.body);
    const comment = parsed.success ? parsed.data.comment : undefined;
    try {
      const incident = await alertService.acknowledgeIncident(String(req.params.id), teamId, userId, comment);
      res.json({ incident });
    } catch (error) {
      if (handleServiceError(error, res)) return;
      throw error;
    }
  },
);

writeRoute("post", "/alerts/incidents/:id/resolve", incidentTeam, async ({ req, res, userId, teamId }) => {
  const parsed = incidentActionSchema.safeParse(req.body);
  const comment = parsed.success ? parsed.data.comment : undefined;
  try {
    const incident = await alertService.resolveIncident(String(req.params.id), teamId, userId, comment);
    res.json({ incident });
  } catch (error) {
    if (handleServiceError(error, res)) return;
    throw error;
  }
});

writeRoute("post", "/alerts/incidents/:id/reopen", incidentTeam, async ({ req, res, userId, teamId }) => {
  const parsed = incidentActionSchema.safeParse(req.body);
  const comment = parsed.success ? parsed.data.comment : undefined;
  try {
    const incident = await alertService.reopenIncident(String(req.params.id), teamId, userId, comment);
    res.json({ incident });
  } catch (error) {
    if (handleServiceError(error, res)) return;
    throw error;
  }
});

// Opaque timeline cursor: base64url of "<incidentId>:<createdAt ISO>:<id>",
// the incident plus the keyset of the last row of the page (the order is
// createdAt then id, and that pair is unique). The incident id is part of the
// cursor, so a cursor issued for another incident is refused with the same 400
// as an undecodable one, before any query. A timestamp is accepted only when
// it round-trips through toISOString exactly (the canonical UTC form the route
// itself writes) and its UTC year is between 1970 and 9999: an extended-year
// timestamp (e.g. -271821-04-20T00:00:00.000Z) parses and round-trips but
// makes the database driver throw, so it must not reach a query.
function decodeTimelineCursor(value: string, incidentId: string): { createdAt: Date; id: string } | null {
  const decoded = Buffer.from(value, "base64url").toString("utf8");
  const first = decoded.indexOf(":");
  const last = decoded.lastIndexOf(":");
  if (first <= 0 || last <= first) return null;
  const cursorIncidentId = decoded.slice(0, first);
  const timestamp = decoded.slice(first + 1, last);
  const id = decoded.slice(last + 1);
  if (id === "") return null;
  if (cursorIncidentId !== incidentId) return null;
  const createdAt = new Date(timestamp);
  if (Number.isNaN(createdAt.getTime())) return null;
  if (createdAt.toISOString() !== timestamp) return null;
  const year = createdAt.getUTCFullYear();
  if (year < 1970 || year > 9999) return null;
  return { createdAt, id };
}

function encodeTimelineCursor(incidentId: string, createdAt: Date, id: string): string {
  return Buffer.from(`${incidentId}:${createdAt.toISOString()}:${id}`, "utf8").toString("base64url");
}

const TIMELINE_DEFAULT_LIMIT = 100;

apiRouter.get(
  "/alerts/incidents/:id/timeline",
  asyncHandler(async (req, res) => {
    const userId = await requireAuth(req, res);
    if (userId === null) return;
    const teamId = await requireIncidentTeam(String(req.params.id), userId, res);
    if (teamId === null) return;
    let limit = TIMELINE_DEFAULT_LIMIT;
    if (req.query.limit !== undefined) {
      const parsed = Number(req.query.limit);
      if (!Number.isInteger(parsed) || parsed < 1) {
        res.status(400).json({ error: "limit must be a positive integer" });
        return;
      }
      // Same message shape as the search limit clamp (enforceSearchLimits).
      if (parsed > config.maxPageSize) {
        res.status(400).json({ error: `limit exceeds maximum of ${config.maxPageSize}` });
        return;
      }
      limit = parsed;
    }
    let after: { createdAt: Date; id: string } | undefined;
    if (req.query.cursor !== undefined) {
      const decoded = decodeTimelineCursor(String(req.query.cursor), String(req.params.id));
      if (decoded === null) {
        res.status(400).json({ error: "Invalid cursor" });
        return;
      }
      after = decoded;
    }
    const { events, hasMore } = await alertService.getIncidentTimeline(String(req.params.id), teamId, {
      limit,
      after,
    });
    const last = events[events.length - 1];
    const nextCursor =
      hasMore && last !== undefined
        ? encodeTimelineCursor(String(req.params.id), last.createdAt, last.id)
        : null;
    res.json({ events, nextCursor });
  }),
);

// --- Subscriptions ---

apiRouter.get(
  "/subscriptions",
  asyncHandler(async (req, res) => {
    const userId = await requireAuth(req, res);
    if (userId === null) return;
    const teamId = String(req.query.teamId ?? "");
    if (!teamId) {
      res.status(400).json({ error: "teamId is required" });
      return;
    }
    if ((await requireTeamRole(userId, teamId, res)) === null) return;
    const subscriptions = await subscriptionService.listByUser(userId, teamId);
    res.json({ subscriptions });
  }),
);

// SSRF guard at the input boundary: for URL-bearing channels, validate the
// configured webhook target before persisting. Returns an error string on
// rejection, or null when safe / not applicable. Delivery-time validation in
// the channel senders provides defense in depth against later DNS rebinding.
async function validateSubscriptionWebhook(
  channel: string | undefined,
  config: Record<string, unknown> | undefined,
): Promise<string | null> {
  if (!config) return null;
  let urlKey: string | null = null;
  if (channel === "WEBHOOK") urlKey = "url";
  else if (channel === "SLACK" || channel === "MSTEAMS") urlKey = "webhook_url";
  if (!urlKey) return null;
  const candidate = config[urlKey];
  if (typeof candidate !== "string" || candidate.length === 0) return null;
  try {
    await assertSafeUrl(candidate);
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : "Invalid webhook URL";
  }
}

apiRouter.post(
  "/subscriptions",
  asyncHandler(async (req, res) => {
    const userId = await requireAuth(req, res);
    if (userId === null) return;
    const parsed = createSubscriptionSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    const webhookError = await validateSubscriptionWebhook(parsed.data.channel, parsed.data.config);
    if (webhookError) {
      res.status(400).json({ error: webhookError });
      return;
    }
    if ((await requireTeamRole(userId, parsed.data.teamId, res)) === null) return;
    // A rule id from another team must not be subscribable: listByUser returns
    // the rule's name. A foreign and a nonexistent rule answer the same 404, so
    // the id gives no existence oracle.
    if (parsed.data.ruleId !== undefined) {
      const rule = await prisma.alertRule.findFirst({
        where: { id: parsed.data.ruleId, teamId: parsed.data.teamId },
        select: { id: true },
      });
      if (!rule) {
        res.status(404).json({ error: "Alert rule not found" });
        return;
      }
    }
    const subscription = await subscriptionService.create({ ...parsed.data, userId });
    res.status(201).json({ subscription });
  }),
);

apiRouter.put(
  "/subscriptions/:id",
  asyncHandler(async (req, res) => {
    const userId = await requireAuth(req, res);
    if (userId === null) return;
    const parsed = updateSubscriptionSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    const webhookError = await validateSubscriptionWebhook(parsed.data.channel, parsed.data.config);
    if (webhookError) {
      res.status(400).json({ error: webhookError });
      return;
    }
    try {
      const subscription = await subscriptionService.update(String(req.params.id), userId, parsed.data);
      res.json({ subscription });
    } catch (error) {
      if (handlePrismaError(error, res, { notFound: "Subscription not found" })) return;
      throw error;
    }
  }),
);

apiRouter.delete(
  "/subscriptions/:id",
  asyncHandler(async (req, res) => {
    const userId = await requireAuth(req, res);
    if (userId === null) return;
    try {
      await subscriptionService.delete(String(req.params.id), userId);
      res.status(204).end();
    } catch (error) {
      if (handlePrismaError(error, res, { notFound: "Subscription not found" })) return;
      throw error;
    }
  }),
);

// --- Test notification ---

apiRouter.post(
  "/subscriptions/:id/test",
  requireAuthMiddleware,
  notificationTestLimiter,
  asyncHandler(async (req, res) => {
    // requireAuthMiddleware above already resolved and validated the
    // caller (401 otherwise, before the limiter), so this is always set.
    const userId = (req as Request & { userId?: string }).userId as string;
    const subscription = await prisma.alertSubscription.findFirst({
      where: { id: String(req.params.id), userId },
      include: { user: { select: { id: true, email: true, name: true } } },
    });
    if (!subscription) {
      res.status(404).json({ error: "Subscription not found" });
      return;
    }
    const { NotificationDispatcher } = await import("../../services/notification/notification-dispatcher.js");
    const dispatcher = new NotificationDispatcher();
    try {
      // Only the caller's own loaded subscription is notified: dispatch()
      // would fan out to every enabled subscriber of the rule/team.
      await dispatcher.dispatchToSubscription(subscription, {
        id: "test-incident-000",
        ruleId: subscription.ruleId ?? "test-rule",
        teamId: subscription.teamId,
        severity: "LOW",
        status: "OPEN",
        message: "This is a test notification from Telerithm",
        createdAt: new Date().toISOString(),
      });
      res.json({ ok: true, message: "Test notification sent" });
    } catch (error) {
      if (error instanceof ChannelConfigError) {
        // A guard refusal or a missing URL describes the caller's own config.
        res.status(500).json({ error: error.message });
        return;
      }
      // Every other failure describes the remote host or the network path to
      // it (a non-2xx answer, a refused connection, a timeout). The status,
      // status text and error text stay in the server log; the caller only
      // learns "rejected" or "not reached".
      if (error instanceof ChannelHttpError) {
        log.warn(
          {
            subscriptionId: subscription.id,
            channel: subscription.channel,
            status: error.status,
            statusText: error.statusText,
          },
          "Test notification rejected by the channel",
        );
        res.status(500).json({ error: "The channel rejected the test notification" });
        return;
      }
      log.warn(
        {
          subscriptionId: subscription.id,
          channel: subscription.channel,
          error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
        },
        "Test notification could not reach the channel",
      );
      res.status(500).json({ error: "The channel could not be reached" });
    }
  }),
);

// --- Issues ---

apiRouter.get(
  "/issues",
  asyncHandler(async (req, res) => {
    const userId = await requireAuth(req, res);
    if (userId === null) return;
    const parsed = issueQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    const { teamId, query, status, service, level, sortBy, sortDirection, limit, offset } = parsed.data;
    if ((await requireTeamRole(userId, teamId, res)) === null) return;
    const result = await issueService.list(
      teamId,
      { query, status, service, level },
      { sortBy, sortDirection },
      limit,
      offset,
    );
    res.json(result);
  }),
);

apiRouter.get(
  "/issues/:id",
  asyncHandler(async (req, res) => {
    const userId = await requireAuth(req, res);
    if (userId === null) return;
    const issue = await issueService.getById(String(req.params.id));
    if (!issue) {
      res.status(404).json({ error: "Issue not found" });
      return;
    }
    // Scope by the issue's own team, not mere existence, otherwise any
    // authenticated user could read any issue by enumerating its id (IDOR).
    // A non-member gets the same 404 as for an unknown id.
    if ((await requireTeamRole(userId, issue.teamId, res, "Issue not found")) === null) return;
    res.json({ issue });
  }),
);

// Resolve an issue's team; writeRoute then requires the caller's membership
// on it with a write-capable role, otherwise any authenticated user could
// change status of or reassign any issue by enumerating its id (cross-tenant
// IDOR).
const loadIssueTeamId = (issueId: string) =>
  issueService.getById(issueId).then((issue) => issue?.teamId ?? null);

writeRoute(
  "put",
  "/issues/:id",
  teamFromResource(loadIssueTeamId, "Issue not found", issueUpdateSchema),
  async ({ req, res, teamId, input }) => {
    let issue;
    if (input.status) {
      issue = await issueService.updateStatus(String(req.params.id), input.status);
    }
    if (input.assigneeId !== undefined) {
      // An assignee must be a member of the issue's team; reject cross-team
      // or non-member user ids.
      if (input.assigneeId !== null) {
        const assigneeMembership = await prisma.teamMember.findUnique({
          where: { teamId_userId: { teamId, userId: input.assigneeId } },
        });
        if (!assigneeMembership) {
          res.status(400).json({ error: "Assignee is not a member of the issue's team" });
          return;
        }
      }
      issue = await issueService.assign(String(req.params.id), input.assigneeId);
    }
    res.json({ issue });
  },
);

// --- Team Invites ---

// Invite management is restricted to OWNER/ADMIN of the affected team: an
// invite grants membership up to role ADMIN, and the list payload carries the
// join token, so mere membership must not be enough (cross-tenant IDOR /
// privilege escalation otherwise).
function canManageInvites(role: "OWNER" | "ADMIN" | "MEMBER" | "VIEWER"): boolean {
  return role === "OWNER" || role === "ADMIN";
}

// Shared log-view state is team-wide: a shared view is visible to every
// member, and isDefault: true makes LogViewService clear the default flag of
// every shared view in the team. Only OWNER/ADMIN may create or edit that
// state; private views stay open to every member, VIEWER included. This is
// the single place the rule lives: the POST and PUT handlers gate on it
// before any mutation, and the service-level update, duplicate and remove
// paths receive it as their canManageShared input.
function canManageShared(role: TeamRoleName): boolean {
  return role === "OWNER" || role === "ADMIN";
}

apiRouter.post(
  "/teams/:id/invites",
  asyncHandler(async (req, res) => {
    const userId = await requireAuth(req, res);
    if (userId === null) return;
    const parsed = createInviteSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    const teamId = String(req.params.id);
    const role = await requireTeamRole(userId, teamId, res);
    if (role === null) return;
    if (!canManageInvites(role)) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    try {
      const invite = await teamService.createInvite(teamId, userId, parsed.data.role, parsed.data.email);
      res.status(201).json({ invite });
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : "Failed" });
    }
  }),
);

apiRouter.get(
  "/teams/:id/invites",
  asyncHandler(async (req, res) => {
    const userId = await requireAuth(req, res);
    if (userId === null) return;
    const teamId = String(req.params.id);
    const role = await requireTeamRole(userId, teamId, res);
    if (role === null) return;
    if (!canManageInvites(role)) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    const invites = await teamService.listInvites(teamId);
    res.json({ invites });
  }),
);

// The deliberate rejections of TeamService.acceptInvite (invalid/expired/used
// or wrong-email invite, already a member): their message is the client-facing
// verdict, so the accept route answers 400 with it. Anything outside this list
// is unexpected and its message may carry internals (a Prisma error quotes the
// server's source path and a code excerpt), so it gets a generic 500 and the
// raw error goes to the log only. The list lives in the route, not the
// service: mapping failures onto HTTP is the router's job everywhere else
// (handlePrismaError, handleServiceError), and this keeps all three answers in
// one place.
const ACCEPT_INVITE_EXPECTED_ERRORS = new Set([
  "Invalid invite token",
  "Invite already used",
  "Invite expired",
  "Invite is for a different email",
  "Already a member of this team",
]);

apiRouter.post(
  "/invites/:token/accept",
  asyncHandler(async (req, res) => {
    const userId = await requireAuth(req, res);
    if (userId === null) return;
    try {
      const team = await teamService.acceptInvite(String(req.params.token), userId);
      res.json({ team });
    } catch (error) {
      // A membership create that loses the race to a concurrent accept hits
      // the (teamId, userId) unique constraint: Prisma's P2002, whose
      // multi-line message must never reach the client. Same answer as the
      // service's already-a-member pre-check (400, like every expected invite
      // failure here). The code check is structural the way handlePrismaError
      // does it; 409 would split one outcome across two statuses, because the
      // pre-check answers 400 today and every expected error on this route is
      // a 400.
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        (error as { code?: unknown }).code === "P2002"
      ) {
        res.status(400).json({ error: "Already a member of this team" });
        return;
      }
      if (error instanceof Error && ACCEPT_INVITE_EXPECTED_ERRORS.has(error.message)) {
        res.status(400).json({ error: error.message });
        return;
      }
      // Unexpected failure: details to the server log only (the invite token
      // is deliberately not part of the context), one generic answer out.
      log.error({ err: error }, "Invite accept failed");
      res.status(500).json({ error: "Could not accept the invite" });
    }
  }),
);

apiRouter.delete(
  "/invites/:id",
  asyncHandler(async (req, res) => {
    const userId = await requireAuth(req, res);
    if (userId === null) return;
    // Resolve the invite's team first and authorize against it, otherwise any
    // authenticated user could revoke any team's invite by enumerating ids
    // (cross-tenant IDOR).
    const inviteId = String(req.params.id);
    const invite = await prisma.teamInvite.findUnique({ where: { id: inviteId } });
    if (!invite) {
      res.status(404).json({ error: "Invite not found" });
      return;
    }
    // A non-member and a member without the manage role both get the same 404
    // as for an unknown id, so the status reveals whether an invite exists
    // neither across teams nor inside one.
    const role = await requireTeamRole(userId, invite.teamId, res, "Invite not found");
    if (role === null) return;
    if (!canManageInvites(role)) {
      res.status(404).json({ error: "Invite not found" });
      return;
    }
    try {
      await teamService.revokeInvite(inviteId, invite.teamId);
      res.status(204).end();
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : "Failed" });
    }
  }),
);

// --- Admin API ---

async function requireAdmin(req: Request, res: Response): Promise<string | null> {
  try {
    const userId = await resolveUserId(req);
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user || user.role !== "ADMIN") {
      res.status(403).json({ error: "Admin access required" });
      return null;
    }
    return userId;
  } catch {
    res.status(401).json({ error: "Unauthorized" });
    return null;
  }
}

apiRouter.get(
  "/admin/users",
  asyncHandler(async (req, res) => {
    if (!(await requireAdmin(req, res))) return;
    const users = await prisma.user.findMany({
      include: {
        teams: {
          include: {
            team: {
              select: { id: true, name: true, slug: true },
            },
          },
          orderBy: { joinedAt: "asc" },
        },
      },
      orderBy: { createdAt: "desc" },
    });
    res.json({
      users: users.map((user) => ({
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        status: user.status,
        createdAt: user.createdAt.toISOString(),
        teams: user.teams.map((membership) => ({
          id: membership.team.id,
          name: membership.team.name,
          slug: membership.team.slug,
          role: membership.role,
          joinedAt: membership.joinedAt.toISOString(),
        })),
      })),
    });
  }),
);

apiRouter.put(
  "/admin/users/:id",
  asyncHandler(async (req, res) => {
    if (!(await requireAdmin(req, res))) return;
    const parsed = updateUserRoleSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    const data: Record<string, unknown> = {};
    if (parsed.data.role) data.role = parsed.data.role;
    if (parsed.data.status) data.status = parsed.data.status;
    if (parsed.data.disabled !== undefined) data.status = parsed.data.disabled ? "DISABLED" : "ACTIVE";
    try {
      const user = await prisma.user.update({
        where: { id: String(req.params.id) },
        select: { id: true, email: true, name: true, role: true, status: true, createdAt: true },
        data,
      });
      // A user who is not ACTIVE (disabled, or sent back to pending) loses every
      // session at once. The token check already refuses such a user; deleting
      // the rows keeps the table clean and means a later re-enable starts from a
      // fresh login rather than reviving an old token.
      if (user.status !== "ACTIVE") {
        await prisma.session.deleteMany({ where: { userId: user.id } });
      }
      res.json({
        user: {
          ...user,
          createdAt: user.createdAt.toISOString(),
        },
      });
    } catch (error) {
      if (handlePrismaError(error, res, { notFound: "User not found" })) return;
      throw error;
    }
  }),
);

apiRouter.post(
  "/admin/users/:id/approve",
  asyncHandler(async (req, res) => {
    if (!(await requireAdmin(req, res))) return;
    try {
      const user = await teamService.approveUser(String(req.params.id));
      res.json({ user });
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : "Failed" });
    }
  }),
);

apiRouter.post(
  "/admin/users/:id/add-to-team",
  asyncHandler(async (req, res) => {
    if (!(await requireAdmin(req, res))) return;
    const parsed = addUserToTeamSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }

    try {
      const membership = await teamService.addUserToTeam(
        String(req.params.id),
        parsed.data.teamId,
        parsed.data.role,
      );
      res.status(201).json({
        membership: {
          id: membership.id,
          teamId: membership.teamId,
          userId: membership.userId,
          role: membership.role,
          joinedAt: membership.joinedAt.toISOString(),
        },
      });
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : "Failed" });
    }
  }),
);

apiRouter.delete(
  "/admin/users/:id/remove-from-team/:teamId",
  asyncHandler(async (req, res) => {
    if (!(await requireAdmin(req, res))) return;
    try {
      await teamService.removeUserFromTeam(String(req.params.id), String(req.params.teamId));
      res.status(204).end();
    } catch {
      res.status(404).json({ error: "Member not found" });
    }
  }),
);

apiRouter.get(
  "/admin/teams",
  asyncHandler(async (req, res) => {
    if (!(await requireAdmin(req, res))) return;
    const teams = await prisma.team.findMany({
      include: { _count: { select: { members: true } } },
      orderBy: { createdAt: "desc" },
    });
    res.json({
      teams: teams.map((t) => ({
        id: t.id,
        name: t.name,
        slug: t.slug,
        memberCount: t._count.members,
        createdAt: t.createdAt.toISOString(),
      })),
    });
  }),
);

apiRouter.get(
  "/admin/teams/:id/members",
  asyncHandler(async (req, res) => {
    if (!(await requireAdmin(req, res))) return;
    const members = await prisma.teamMember.findMany({
      where: { teamId: String(req.params.id) },
      include: { user: { select: { id: true, email: true, name: true } } },
    });
    res.json({
      members: members.map((m) => ({
        id: m.id,
        role: m.role,
        joinedAt: m.joinedAt.toISOString(),
        user: m.user,
      })),
    });
  }),
);

apiRouter.delete(
  "/admin/teams/:id/members/:userId",
  asyncHandler(async (req, res) => {
    if (!(await requireAdmin(req, res))) return;
    try {
      await teamService.removeUserFromTeam(String(req.params.userId), String(req.params.id));
      res.status(204).end();
    } catch (error) {
      if (handlePrismaError(error, res, { notFound: "Member not found" })) return;
      throw error;
    }
  }),
);

apiRouter.get(
  "/admin/stats",
  asyncHandler(async (req, res) => {
    if (!(await requireAdmin(req, res))) return;
    const [userCount, teamCount, sourceCount] = await Promise.all([
      prisma.user.count(),
      prisma.team.count(),
      prisma.logSource.count(),
    ]);
    res.json({ userCount, teamCount, sourceCount });
  }),
);

// --- Streaming ---

// A stream ticket: one-time, 60 seconds, bound to the caller's session and one
// team (see services/streaming/stream-ticket.ts). The caller authenticates with
// the Authorization header like on every other route; the ticket then opens
// GET /stream/logs?ticket=... without a header.
apiRouter.post(
  "/stream/ticket",
  asyncHandler(async (req, res) => {
    const session = await requireAuthSession(req, res);
    if (session === null) return;
    const parsed = streamTicketSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    const { teamId } = parsed.data;
    if ((await requireTeamRole(session.userId, teamId, res)) === null) return;
    const issued = await issueStreamTicket(redis, { sessionId: session.id, userId: session.userId, teamId });
    res.set("Cache-Control", "no-store");
    res.status(201).json(issued);
  }),
);

apiRouter.get(
  "/stream/logs",
  asyncHandler(async (req, res) => {
    const auth = await requireStreamAuth(req, res);
    if (auth === null) return;
    const { userId } = auth;
    const teamId = String(req.query.teamId ?? "");
    if (!teamId) {
      res.status(400).json({ error: "teamId is required" });
      return;
    }
    // A ticket opens the stream of the team it was issued for and no other; the
    // answer is the same 401 as for an unknown ticket (the ticket is spent).
    if (auth.ticketTeamId !== undefined && auth.ticketTeamId !== teamId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    if ((await requireTeamRole(userId, teamId, res)) === null) return;
    const sourceId = typeof req.query.sourceId === "string" ? req.query.sourceId : undefined;
    const service = typeof req.query.service === "string" ? req.query.service : undefined;
    const host = typeof req.query.host === "string" ? req.query.host : undefined;
    const level = typeof req.query.level === "string" ? req.query.level : undefined;
    const query = typeof req.query.query === "string" ? req.query.query : undefined;

    // The credentials were checked once above; the stream re-checks the session
    // and the team membership on every heartbeat and ends when either is gone.
    // A user may hold config.maxStreamsPerUser streams at once (per process);
    // the answer to one more is a 429 before any stream header is written.
    const unsubscribe = streamingService.subscribe(
      teamId,
      res,
      {
        sourceId,
        service,
        host,
        level,
        query,
      },
      () => auth.recheck(teamId),
      { userId, max: config.maxStreamsPerUser },
    );
    if (unsubscribe === null) {
      res.status(429).json({ error: "Too many open live tail streams" });
    }
  }),
);
