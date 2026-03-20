import { type Request, type Response, type NextFunction, Router } from "express";
import rateLimit from "express-rate-limit";
import { IngestionService } from "../../ingestion/ingestion-service.js";
import { AlertService } from "../../services/alert/alert-service.js";
import { DashboardService } from "../../services/dashboard/dashboard-service.js";
import { QueryService } from "../../services/query/query-service.js";
import { StreamingService } from "../../services/streaming/streaming-service.js";
import { IssueService } from "../../services/issue/issue-service.js";
import { SubscriptionService } from "../../services/subscription/subscription-service.js";
import { TeamService } from "../../services/team/team-service.js";
import {
  createSourceSchema,
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
  updateSubscriptionSchema,
} from "../../validation/schemas.js";
import { prisma } from "../../repositories/prisma.js";
import { clickhouse } from "../../repositories/clickhouse.js";
import { redis } from "../../repositories/redis.js";
import { createChildLogger } from "../../logger.js";

const log = createChildLogger("router");

export const apiRouter = Router();

const teamService = new TeamService();
const queryService = new QueryService();
const alertService = new AlertService();
const dashboardService = new DashboardService();
const ingestionService = new IngestionService();
const streamingService = new StreamingService(ingestionService.events);
const subscriptionService = new SubscriptionService();
const issueService = new IssueService();

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

  // Attach source info for downstream use
  (req as Request & { logSource?: typeof source }).logSource = source;
  next();
}

// 2.4 — Sanitize log message content to prevent stored XSS
function sanitizeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}

function sanitizeLogFields(
  fields: Record<string, string | number | boolean>,
): Record<string, string | number | boolean> {
  const sanitized: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(fields)) {
    sanitized[sanitizeHtml(key)] = typeof value === "string" ? sanitizeHtml(value) : value;
  }
  return sanitized;
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
    try {
      const teams = await teamService.listTeamsForToken(parseToken(req.header("authorization")));
      res.json({ teams });
    } catch (error) {
      res.status(401).json({ error: error instanceof Error ? error.message : "Unauthorized" });
    }
  }),
);

apiRouter.post(
  "/teams",
  asyncHandler(async (req, res) => {
    const parsed = createTeamSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    try {
      const team = await teamService.createTeam(
        parseToken(req.header("authorization")),
        parsed.data.name,
        parsed.data.slug,
      );
      res.status(201).json({ team });
    } catch (error) {
      res.status(401).json({ error: error instanceof Error ? error.message : "Unauthorized" });
    }
  }),
);

apiRouter.get(
  "/sources",
  asyncHandler(async (req, res) => {
    const teamId = String(req.query.teamId ?? "");
    if (!teamId) {
      res.status(400).json({ error: "teamId is required" });
      return;
    }
    const sources = await teamService.listSources(teamId);
    res.json({ sources });
  }),
);

apiRouter.post(
  "/sources",
  asyncHandler(async (req, res) => {
    const parsed = createSourceSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
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

    // 2.4 — Sanitize log messages before storage
    const sanitizedPayload = {
      ...parsed.data,
      logs: parsed.data.logs.map((item) => {
        if (typeof item === "string") return sanitizeHtml(item);
        return {
          ...item,
          message: item.message ? sanitizeHtml(item.message) : item.message,
          host: item.host ? sanitizeHtml(item.host) : item.host,
          service: item.service ? sanitizeHtml(item.service) : item.service,
          fields: item.fields ? sanitizeLogFields(item.fields) : item.fields,
        };
      }),
    };

    try {
      const response = await ingestionService.ingest(String(req.params.sourceId), sanitizedPayload);
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
    const payload = { logs: lines.map((l: string) => sanitizeHtml(l)) };
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
    const parsed = searchSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    const result = await queryService.search(parsed.data);
    res.json(result);
  }),
);

apiRouter.get(
  "/logs",
  asyncHandler(async (req, res) => {
    const parsed = searchSchema.safeParse({
      teamId: req.query.teamId,
      sourceId: req.query.sourceId,
      startTime: req.query.startTime,
      endTime: req.query.endTime,
      query: req.query.query,
      queryType: req.query.queryType ?? "sql",
      limit: req.query.limit ? Number(req.query.limit) : 100,
      offset: req.query.offset ? Number(req.query.offset) : 0,
    });
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    const result = await queryService.search(parsed.data);
    res.json(result);
  }),
);

apiRouter.post("/query/natural", (req, res) => {
  const parsed = naturalQuerySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  res.json(queryService.explainNaturalQuery(parsed.data.teamId, parsed.data.query));
});

apiRouter.get(
  "/alerts/rules",
  asyncHandler(async (req, res) => {
    const teamId = String(req.query.teamId ?? "");
    if (!teamId) {
      res.status(400).json({ error: "teamId is required" });
      return;
    }
    const rules = await alertService.listRules(teamId);
    res.json({ rules });
  }),
);

apiRouter.get(
  "/alerts/incidents",
  asyncHandler(async (req, res) => {
    const teamId = String(req.query.teamId ?? "");
    if (!teamId) {
      res.status(400).json({ error: "teamId is required" });
      return;
    }
    const incidents = await alertService.listIncidents(teamId);
    res.json({ incidents });
  }),
);

// --- Mute / Unmute ---

apiRouter.post(
  "/alerts/rules/:id/mute",
  asyncHandler(async (req, res) => {
    try {
      await resolveUserId(req);
      const parsed = muteRuleSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.flatten() });
        return;
      }
      const muteUntil = new Date(Date.now() + parsed.data.durationMinutes * 60_000);
      const rule = await prisma.alertRule.update({
        where: { id: String(req.params.id) },
        data: { muteUntil },
      });
      res.json({ rule: { id: rule.id, muteUntil: rule.muteUntil } });
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : "Mute failed" });
    }
  }),
);

apiRouter.post(
  "/alerts/rules/:id/unmute",
  asyncHandler(async (req, res) => {
    try {
      await resolveUserId(req);
      const rule = await prisma.alertRule.update({
        where: { id: String(req.params.id) },
        data: { muteUntil: null },
      });
      res.json({ rule: { id: rule.id, muteUntil: null } });
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : "Unmute failed" });
    }
  }),
);

// --- Maintenance Windows ---

apiRouter.get(
  "/maintenance-windows",
  asyncHandler(async (req, res) => {
    const teamId = String(req.query.teamId ?? "");
    if (!teamId) {
      res.status(400).json({ error: "teamId is required" });
      return;
    }
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
    try {
      await resolveUserId(req);
      const parsed = maintenanceWindowSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.flatten() });
        return;
      }
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
      res.status(400).json({ error: error instanceof Error ? error.message : "Failed" });
    }
  }),
);

apiRouter.delete(
  "/maintenance-windows/:id",
  asyncHandler(async (req, res) => {
    try {
      await resolveUserId(req);
      await prisma.maintenanceWindow.delete({ where: { id: String(req.params.id) } });
      res.status(204).end();
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : "Failed" });
    }
  }),
);

apiRouter.get(
  "/dashboards/overview",
  asyncHandler(async (req, res) => {
    const teamId = String(req.query.teamId ?? "");
    if (!teamId) {
      res.status(400).json({ error: "teamId is required" });
      return;
    }
    const overview = await dashboardService.getOverview(teamId);
    res.json({ overview });
  }),
);

// --- Incident Actions ---

async function resolveUserId(req: Request): Promise<string> {
  const header = req.header("authorization");
  const token = parseToken(typeof header === "string" ? header : header?.[0]);
  const session = await prisma.session.findUnique({ where: { token } });
  if (!session || session.expiresAt < new Date()) {
    throw new Error("Unauthorized");
  }
  return session.userId;
}

apiRouter.post(
  "/alerts/incidents/:id/acknowledge",
  asyncHandler(async (req, res) => {
    try {
      const userId = await resolveUserId(req);
      const parsed = incidentActionSchema.safeParse(req.body);
      const comment = parsed.success ? parsed.data.comment : undefined;
      const incident = await alertService.acknowledgeIncident(String(req.params.id), userId, comment);
      res.json({ incident });
    } catch (error) {
      res.status(401).json({ error: error instanceof Error ? error.message : "Unauthorized" });
    }
  }),
);

apiRouter.post(
  "/alerts/incidents/:id/resolve",
  asyncHandler(async (req, res) => {
    try {
      const userId = await resolveUserId(req);
      const parsed = incidentActionSchema.safeParse(req.body);
      const comment = parsed.success ? parsed.data.comment : undefined;
      const incident = await alertService.resolveIncident(String(req.params.id), userId, comment);
      res.json({ incident });
    } catch (error) {
      res.status(401).json({ error: error instanceof Error ? error.message : "Unauthorized" });
    }
  }),
);

apiRouter.post(
  "/alerts/incidents/:id/reopen",
  asyncHandler(async (req, res) => {
    try {
      const userId = await resolveUserId(req);
      const parsed = incidentActionSchema.safeParse(req.body);
      const comment = parsed.success ? parsed.data.comment : undefined;
      const incident = await alertService.reopenIncident(String(req.params.id), userId, comment);
      res.json({ incident });
    } catch (error) {
      res.status(401).json({ error: error instanceof Error ? error.message : "Unauthorized" });
    }
  }),
);

apiRouter.get(
  "/alerts/incidents/:id/timeline",
  asyncHandler(async (req, res) => {
    try {
      await resolveUserId(req);
      const events = await alertService.getIncidentTimeline(String(req.params.id));
      res.json({ events });
    } catch (error) {
      res.status(401).json({ error: error instanceof Error ? error.message : "Unauthorized" });
    }
  }),
);

// --- Subscriptions ---

apiRouter.get(
  "/subscriptions",
  asyncHandler(async (req, res) => {
    try {
      const userId = await resolveUserId(req);
      const teamId = String(req.query.teamId ?? "");
      if (!teamId) {
        res.status(400).json({ error: "teamId is required" });
        return;
      }
      const subscriptions = await subscriptionService.listByUser(userId, teamId);
      res.json({ subscriptions });
    } catch (error) {
      res.status(401).json({ error: error instanceof Error ? error.message : "Unauthorized" });
    }
  }),
);

apiRouter.post(
  "/subscriptions",
  asyncHandler(async (req, res) => {
    try {
      const userId = await resolveUserId(req);
      const parsed = createSubscriptionSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.flatten() });
        return;
      }
      const subscription = await subscriptionService.create({ ...parsed.data, userId });
      res.status(201).json({ subscription });
    } catch (error) {
      res.status(401).json({ error: error instanceof Error ? error.message : "Unauthorized" });
    }
  }),
);

apiRouter.put(
  "/subscriptions/:id",
  asyncHandler(async (req, res) => {
    try {
      const userId = await resolveUserId(req);
      const parsed = updateSubscriptionSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.flatten() });
        return;
      }
      const subscription = await subscriptionService.update(String(req.params.id), userId, parsed.data);
      res.json({ subscription });
    } catch (error) {
      res.status(401).json({ error: error instanceof Error ? error.message : "Unauthorized" });
    }
  }),
);

apiRouter.delete(
  "/subscriptions/:id",
  asyncHandler(async (req, res) => {
    try {
      const userId = await resolveUserId(req);
      await subscriptionService.delete(String(req.params.id), userId);
      res.status(204).end();
    } catch (error) {
      res.status(401).json({ error: error instanceof Error ? error.message : "Unauthorized" });
    }
  }),
);

// --- Test notification ---

apiRouter.post(
  "/subscriptions/:id/test",
  asyncHandler(async (req, res) => {
    try {
      const userId = await resolveUserId(req);
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
      await dispatcher.dispatch({
        id: "test-incident-000",
        ruleId: subscription.ruleId ?? "test-rule",
        teamId: subscription.teamId,
        severity: "LOW",
        status: "OPEN",
        message: "This is a test notification from LogForge",
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
    const parsed = issueQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    const { teamId, status, service, level, limit, offset } = parsed.data;
    const result = await issueService.list(teamId, { status, service, level }, limit, offset);
    res.json(result);
  }),
);

apiRouter.get(
  "/issues/:id",
  asyncHandler(async (req, res) => {
    const issue = await issueService.getById(String(req.params.id));
    if (!issue) {
      res.status(404).json({ error: "Issue not found" });
      return;
    }
    res.json({ issue });
  }),
);

apiRouter.put(
  "/issues/:id",
  asyncHandler(async (req, res) => {
    try {
      await resolveUserId(req);
      const parsed = issueUpdateSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.flatten() });
        return;
      }
      let issue;
      if (parsed.data.status) {
        issue = await issueService.updateStatus(String(req.params.id), parsed.data.status);
      }
      if (parsed.data.assigneeId !== undefined) {
        issue = await issueService.assign(String(req.params.id), parsed.data.assigneeId);
      }
      res.json({ issue });
    } catch (error) {
      res.status(401).json({ error: error instanceof Error ? error.message : "Unauthorized" });
    }
  }),
);

// --- Streaming ---

apiRouter.get("/stream/logs", (req, res) => {
  const teamId = String(req.query.teamId ?? "");
  if (!teamId) {
    res.status(400).json({ error: "teamId is required" });
    return;
  }
  const unsubscribe = streamingService.subscribe(teamId, res);
  req.on("close", unsubscribe);
});
