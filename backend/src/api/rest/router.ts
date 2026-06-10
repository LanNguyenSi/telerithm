import { randomUUID } from "node:crypto";
import { type Request, type Response, type NextFunction, Router } from "express";
import rateLimit from "express-rate-limit";
import { IngestionService } from "../../ingestion/ingestion-service.js";
import { LogRepository } from "../../repositories/log-repository.js";
import { AlertService } from "../../services/alert/alert-service.js";
import { DashboardService } from "../../services/dashboard/dashboard-service.js";
import { QueryService } from "../../services/query/query-service.js";
import { LogViewService } from "../../services/log-view/log-view-service.js";
import { StreamingService } from "../../services/streaming/streaming-service.js";
import { IssueService } from "../../services/issue/issue-service.js";
import { SubscriptionService } from "../../services/subscription/subscription-service.js";
import { assertSafeUrl } from "../../services/notification/url-guard.js";
import { TeamService } from "../../services/team/team-service.js";
import {
  addUserToTeamSchema,
  createInviteSchema,
  createSourceSchema,
  createSavedViewSchema,
  createSubscriptionSchema,
  createTeamSchema,
  incidentActionSchema,
  ingestSchema,
  issueQuerySchema,
  issueUpdateSchema,
  maintenanceWindowSchema,
  muteRuleSchema,
  loginSchema,
  naturalQuerySchema,
  registerSchema,
  searchSchema,
  contextSchema,
  facetsSchema,
  histogramSchema,
  patternsSchema,
  updateSavedViewSchema,
  updateSubscriptionSchema,
  updateUserRoleSchema,
} from "../../validation/schemas.js";
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

function enforceSearchLimits(input: { startTime?: string; endTime?: string; limit?: number }): string | null {
  if (typeof input.limit === "number" && input.limit > config.maxPageSize) {
    return `limit exceeds maximum of ${config.maxPageSize}`;
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
async function runWithSyncBudget<T>(producer: () => Promise<T>): Promise<T | typeof SYNC_TIMEOUT> {
  const timeout = new Promise<typeof SYNC_TIMEOUT>((resolve) => {
    setTimeout(() => resolve(SYNC_TIMEOUT), config.maxSyncRuntimeMs);
  });
  return Promise.race([producer(), timeout]);
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

apiRouter.get(
  "/health",
  asyncHandler(async (_req, res) => {
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
    res.status(healthy ? 200 : 503).json({ status: healthy ? "ok" : "degraded", checks });
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
    if ((await requireTeamRole(userId, teamId, res)) === null) return;
    const sources = await teamService.listSources(teamId);
    res.json({ sources });
  }),
);

apiRouter.post(
  "/sources",
  asyncHandler(async (req, res) => {
    const userId = await requireAuth(req, res);
    if (userId === null) return;
    const parsed = createSourceSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    if ((await requireTeamRole(userId, parsed.data.teamId, res)) === null) return;
    const source = await teamService.createSource(parsed.data.teamId, parsed.data.name, parsed.data.type);
    res.status(201).json({ source });
  }),
);

// 2.5 — Ingest with API-Key auth + rate limit + sanitization
apiRouter.post(
  "/ingest/:sourceId",
  ingestLimiter,
  authenticateApiKey,
  asyncHandler(async (req, res) => {
    const parsed = ingestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }

    try {
      const response = await ingestionService.ingest(String(req.params.sourceId), parsed.data);
      res.status(202).json(response);
    } catch (error) {
      res.status(404).json({ error: error instanceof Error ? error.message : "Ingest failed" });
    }
  }),
);

// Raw text ingest — one log line per line, accepts text/plain
apiRouter.post(
  "/ingest/:sourceId/raw",
  ingestLimiter,
  authenticateApiKey,
  asyncHandler(async (req, res) => {
    const body = typeof req.body === "string" ? req.body : String(req.body ?? "");
    const lines = body.split("\n").filter((l: string) => l.trim().length > 0);
    if (lines.length === 0) {
      res.status(400).json({ error: "Empty body" });
      return;
    }
    const payload = { logs: lines };
    try {
      const response = await ingestionService.ingest(String(req.params.sourceId), payload);
      res.status(202).json(response);
    } catch (error) {
      res.status(404).json({ error: error instanceof Error ? error.message : "Ingest failed" });
    }
  }),
);

apiRouter.post(
  "/logs/search",
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
    if (parsed.data.async) {
      const asyncStart = queryService.startAsyncJob(() =>
        queryService.getFacets({ ...parsed.data, async: undefined }),
      );
      res.status(202).json({ ...asyncStart, status: "pending" });
      return;
    }
    const syncResult = await runWithSyncBudget(() => queryService.getFacets(parsed.data));
    if (syncResult === SYNC_TIMEOUT) {
      const asyncStart = queryService.startAsyncJob(() =>
        queryService.getFacets({ ...parsed.data, async: undefined }),
      );
      res.status(202).json({ ...asyncStart, status: "pending" });
      return;
    }
    const result = syncResult;
    res.json({ requestId: randomUUID(), partial: false, cached: false, ...result });
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
    if (parsed.data.async) {
      const asyncStart = queryService.startAsyncJob(() =>
        queryService.getHistogram({ ...parsed.data, async: undefined }),
      );
      res.status(202).json({ ...asyncStart, status: "pending" });
      return;
    }
    const syncResult = await runWithSyncBudget(() => queryService.getHistogram(parsed.data));
    if (syncResult === SYNC_TIMEOUT) {
      const asyncStart = queryService.startAsyncJob(() =>
        queryService.getHistogram({ ...parsed.data, async: undefined }),
      );
      res.status(202).json({ ...asyncStart, status: "pending" });
      return;
    }
    const result = syncResult;
    res.json({ requestId: randomUUID(), partial: false, cached: false, ...result });
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
    if (parsed.data.async) {
      const asyncStart = queryService.startAsyncJob(() =>
        queryService.getPatterns({ ...parsed.data, async: undefined }),
      );
      res.status(202).json({ ...asyncStart, status: "pending" });
      return;
    }
    const syncResult = await runWithSyncBudget(() => queryService.getPatterns(parsed.data));
    if (syncResult === SYNC_TIMEOUT) {
      const asyncStart = queryService.startAsyncJob(() =>
        queryService.getPatterns({ ...parsed.data, async: undefined }),
      );
      res.status(202).json({ ...asyncStart, status: "pending" });
      return;
    }
    const result = syncResult;
    res.json({ requestId: randomUUID(), partial: false, cached: false, ...result });
  }),
);

apiRouter.get(
  "/query/jobs/:id",
  asyncHandler(async (req, res) => {
    if ((await requireAuth(req, res)) === null) return;
    const job = queryService.getAsyncJob(String(req.params.id));
    if (!job) {
      res.status(404).json({ error: "Job not found" });
      return;
    }
    res.json(job);
  }),
);

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
    if ((await requireTeamRole(userId, parsed.data.teamId, res)) === null) return;
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
    const view = await logViewService.update(String(req.params.id), {
      teamId,
      userId,
      canManageShared: role === "OWNER" || role === "ADMIN",
      ...parsed.data,
    });
    res.json({ view });
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
    const view = await logViewService.duplicate(String(req.params.id), {
      teamId,
      userId,
      canManageShared: role === "OWNER" || role === "ADMIN",
      name,
    });
    res.status(201).json({ view });
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
    await logViewService.remove(String(req.params.id), {
      teamId,
      userId,
      canManageShared: role === "OWNER" || role === "ADMIN",
    });
    res.status(204).end();
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

apiRouter.post(
  "/alerts/rules/:id/mute",
  asyncHandler(async (req, res) => {
    if ((await requireAuth(req, res)) === null) return;
    const parsed = muteRuleSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    const muteUntil = new Date(Date.now() + parsed.data.durationMinutes * 60_000);
    try {
      const rule = await prisma.alertRule.update({
        where: { id: String(req.params.id) },
        data: { muteUntil },
      });
      res.json({ rule: { id: rule.id, muteUntil: rule.muteUntil } });
    } catch (error) {
      if (handlePrismaError(error, res, { notFound: "Alert rule not found" })) return;
      throw error;
    }
  }),
);

apiRouter.post(
  "/alerts/rules/:id/unmute",
  asyncHandler(async (req, res) => {
    if ((await requireAuth(req, res)) === null) return;
    try {
      const rule = await prisma.alertRule.update({
        where: { id: String(req.params.id) },
        data: { muteUntil: null },
      });
      res.json({ rule: { id: rule.id, muteUntil: null } });
    } catch (error) {
      if (handlePrismaError(error, res, { notFound: "Alert rule not found" })) return;
      throw error;
    }
  }),
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

apiRouter.post(
  "/maintenance-windows",
  asyncHandler(async (req, res) => {
    const userId = await requireAuth(req, res);
    if (userId === null) return;
    const parsed = maintenanceWindowSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    if ((await requireTeamRole(userId, parsed.data.teamId, res)) === null) return;
    try {
      const window = await prisma.maintenanceWindow.create({
        data: {
          teamId: parsed.data.teamId,
          name: parsed.data.name,
          startsAt: new Date(parsed.data.startsAt),
          endsAt: new Date(parsed.data.endsAt),
        },
      });
      res.status(201).json({ window });
    } catch (error) {
      if (handlePrismaError(error, res, { conflict: "Maintenance window already exists" })) return;
      throw error;
    }
  }),
);

apiRouter.delete(
  "/maintenance-windows/:id",
  asyncHandler(async (req, res) => {
    if ((await requireAuth(req, res)) === null) return;
    try {
      await prisma.maintenanceWindow.delete({ where: { id: String(req.params.id) } });
      res.status(204).end();
    } catch (error) {
      if (handlePrismaError(error, res, { notFound: "Maintenance window not found" })) return;
      throw error;
    }
  }),
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

async function resolveUserId(req: Request): Promise<string> {
  const header = req.header("authorization");
  const token = parseToken(header);
  const session = await prisma.session.findUnique({ where: { token } });
  if (!session || session.expiresAt < new Date()) {
    throw new Error("Unauthorized");
  }
  return session.userId;
}

// SSE-only variant: accepts the bearer token via `?token=` in addition to
// the Authorization header, because `EventSource` cannot set headers.
// Only mounted on /stream/logs; every other route stays header-only via
// resolveUserId. The token in URL leaks into the access log, so the http
// logger in app.ts redacts `token=...` before writing.
async function resolveStreamUserId(req: Request): Promise<string> {
  const header = req.header("authorization");
  const headerToken = header ? header.replace(/^Bearer\s+/i, "") : undefined;
  const queryToken = typeof req.query.token === "string" ? req.query.token : undefined;
  const token = headerToken || queryToken;
  if (!token) {
    throw new Error("Unauthorized");
  }
  const session = await prisma.session.findUnique({ where: { token } });
  if (!session || session.expiresAt < new Date()) {
    throw new Error("Unauthorized");
  }
  return session.userId;
}

async function requireStreamAuth(req: Request, res: Response): Promise<string | null> {
  try {
    return await resolveStreamUserId(req);
  } catch {
    res.status(401).json({ error: "Unauthorized" });
    return null;
  }
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

async function resolveTeamRole(
  userId: string,
  teamId: string,
): Promise<"OWNER" | "ADMIN" | "MEMBER" | "VIEWER"> {
  const membership = await prisma.teamMember.findUnique({
    where: { teamId_userId: { teamId, userId } },
  });
  if (!membership) {
    throw new Error("Forbidden");
  }
  return membership.role as "OWNER" | "ADMIN" | "MEMBER" | "VIEWER";
}

// Team-membership gate, mirrored on requireAuth: returns the role on
// success, or sends a 403 and returns null. Used after requireAuth so
// non-member callers get a Forbidden response instead of a 500 from the
// async error middleware.
async function requireTeamRole(
  userId: string,
  teamId: string,
  res: Response,
): Promise<"OWNER" | "ADMIN" | "MEMBER" | "VIEWER" | null> {
  try {
    return await resolveTeamRole(userId, teamId);
  } catch {
    res.status(403).json({ error: "Forbidden" });
    return null;
  }
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

apiRouter.post(
  "/alerts/incidents/:id/acknowledge",
  asyncHandler(async (req, res) => {
    const userId = await requireAuth(req, res);
    if (userId === null) return;
    const parsed = incidentActionSchema.safeParse(req.body);
    const comment = parsed.success ? parsed.data.comment : undefined;
    const incident = await alertService.acknowledgeIncident(String(req.params.id), userId, comment);
    res.json({ incident });
  }),
);

apiRouter.post(
  "/alerts/incidents/:id/resolve",
  asyncHandler(async (req, res) => {
    const userId = await requireAuth(req, res);
    if (userId === null) return;
    const parsed = incidentActionSchema.safeParse(req.body);
    const comment = parsed.success ? parsed.data.comment : undefined;
    const incident = await alertService.resolveIncident(String(req.params.id), userId, comment);
    res.json({ incident });
  }),
);

apiRouter.post(
  "/alerts/incidents/:id/reopen",
  asyncHandler(async (req, res) => {
    const userId = await requireAuth(req, res);
    if (userId === null) return;
    const parsed = incidentActionSchema.safeParse(req.body);
    const comment = parsed.success ? parsed.data.comment : undefined;
    const incident = await alertService.reopenIncident(String(req.params.id), userId, comment);
    res.json({ incident });
  }),
);

apiRouter.get(
  "/alerts/incidents/:id/timeline",
  asyncHandler(async (req, res) => {
    if ((await requireAuth(req, res)) === null) return;
    const events = await alertService.getIncidentTimeline(String(req.params.id));
    res.json({ events });
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
    const subscription = await subscriptionService.update(String(req.params.id), userId, parsed.data);
    res.json({ subscription });
  }),
);

apiRouter.delete(
  "/subscriptions/:id",
  asyncHandler(async (req, res) => {
    const userId = await requireAuth(req, res);
    if (userId === null) return;
    await subscriptionService.delete(String(req.params.id), userId);
    res.status(204).end();
  }),
);

// --- Test notification ---

apiRouter.post(
  "/subscriptions/:id/test",
  asyncHandler(async (req, res) => {
    const userId = await requireAuth(req, res);
    if (userId === null) return;
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
      await dispatcher.dispatch({
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
      res.status(500).json({ error: error instanceof Error ? error.message : "Failed to send test" });
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
    if ((await requireTeamRole(userId, issue.teamId, res)) === null) return;
    res.json({ issue });
  }),
);

apiRouter.put(
  "/issues/:id",
  asyncHandler(async (req, res) => {
    const userId = await requireAuth(req, res);
    if (userId === null) return;
    const parsed = issueUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    // Load the target issue first and authorize against its team before any
    // mutation, otherwise any authenticated user could change status of or
    // reassign any issue by enumerating its id (cross-tenant IDOR).
    const existing = await issueService.getById(String(req.params.id));
    if (!existing) {
      res.status(404).json({ error: "Issue not found" });
      return;
    }
    if ((await requireTeamRole(userId, existing.teamId, res)) === null) return;
    let issue;
    if (parsed.data.status) {
      issue = await issueService.updateStatus(String(req.params.id), parsed.data.status);
    }
    if (parsed.data.assigneeId !== undefined) {
      // An assignee must be a member of the issue's team; reject cross-team
      // or non-member user ids.
      if (parsed.data.assigneeId !== null) {
        const assigneeMembership = await prisma.teamMember.findUnique({
          where: { teamId_userId: { teamId: existing.teamId, userId: parsed.data.assigneeId } },
        });
        if (!assigneeMembership) {
          res.status(400).json({ error: "Assignee is not a member of the issue's team" });
          return;
        }
      }
      issue = await issueService.assign(String(req.params.id), parsed.data.assigneeId);
    }
    res.json({ issue });
  }),
);

// --- Team Invites ---

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
    try {
      const invite = await teamService.createInvite(
        String(req.params.id),
        userId,
        parsed.data.role,
        parsed.data.email,
      );
      res.status(201).json({ invite });
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : "Failed" });
    }
  }),
);

apiRouter.get(
  "/teams/:id/invites",
  asyncHandler(async (req, res) => {
    if ((await requireAuth(req, res)) === null) return;
    const invites = await teamService.listInvites(String(req.params.id));
    res.json({ invites });
  }),
);

apiRouter.post(
  "/invites/:token/accept",
  asyncHandler(async (req, res) => {
    const userId = await requireAuth(req, res);
    if (userId === null) return;
    try {
      const team = await teamService.acceptInvite(String(req.params.token), userId);
      res.json({ team });
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : "Failed" });
    }
  }),
);

apiRouter.delete(
  "/invites/:id",
  asyncHandler(async (req, res) => {
    if ((await requireAuth(req, res)) === null) return;
    try {
      await teamService.revokeInvite(String(req.params.id));
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
      await prisma.teamMember.delete({
        where: {
          teamId_userId: {
            teamId: String(req.params.id),
            userId: String(req.params.userId),
          },
        },
      });
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

apiRouter.get(
  "/stream/logs",
  asyncHandler(async (req, res) => {
    const userId = await requireStreamAuth(req, res);
    if (userId === null) return;
    const teamId = String(req.query.teamId ?? "");
    if (!teamId) {
      res.status(400).json({ error: "teamId is required" });
      return;
    }
    if ((await requireTeamRole(userId, teamId, res)) === null) return;
    const sourceId = typeof req.query.sourceId === "string" ? req.query.sourceId : undefined;
    const service = typeof req.query.service === "string" ? req.query.service : undefined;
    const host = typeof req.query.host === "string" ? req.query.host : undefined;
    const level = typeof req.query.level === "string" ? req.query.level : undefined;
    const query = typeof req.query.query === "string" ? req.query.query : undefined;

    const unsubscribe = streamingService.subscribe(teamId, res, {
      sourceId,
      service,
      host,
      level,
      query,
    });
    req.on("close", unsubscribe);
  }),
);
