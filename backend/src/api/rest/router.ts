import { Router } from "express";
import { IngestionService } from "../../ingestion/ingestion-service.js";
import { AlertService } from "../../services/alert/alert-service.js";
import { DashboardService } from "../../services/dashboard/dashboard-service.js";
import { QueryService } from "../../services/query/query-service.js";
import { StreamingService } from "../../services/streaming/streaming-service.js";
import { TeamService } from "../../services/team/team-service.js";
import {
  createSourceSchema,
  createTeamSchema,
  ingestSchema,
  loginSchema,
  naturalQuerySchema,
  registerSchema,
  searchSchema,
} from "../../validation/schemas.js";

export const apiRouter = Router();

const teamService = new TeamService();
const queryService = new QueryService();
const alertService = new AlertService();
const dashboardService = new DashboardService();
const ingestionService = new IngestionService();
const streamingService = new StreamingService();

function parseToken(header?: string): string {
  if (!header) {
    throw new Error("Missing authorization header");
  }
  return header.replace(/^Bearer\s+/i, "");
}

apiRouter.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

apiRouter.post("/auth/register", (req, res) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  try {
    const result = teamService.register(parsed.data.email, parsed.data.password, parsed.data.name);
    return res.status(201).json(result);
  } catch (error) {
    return res.status(400).json({ error: error instanceof Error ? error.message : "Register failed" });
  }
});

apiRouter.post("/auth/login", (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  try {
    const result = teamService.login(parsed.data.email, parsed.data.password);
    return res.json(result);
  } catch (error) {
    return res.status(401).json({ error: error instanceof Error ? error.message : "Login failed" });
  }
});

apiRouter.get("/teams", (req, res) => {
  try {
    const teams = teamService.listTeamsForToken(parseToken(req.header("authorization")));
    return res.json({ teams });
  } catch (error) {
    return res.status(401).json({ error: error instanceof Error ? error.message : "Unauthorized" });
  }
});

apiRouter.post("/teams", (req, res) => {
  const parsed = createTeamSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  try {
    const team = teamService.createTeam(
      parseToken(req.header("authorization")),
      parsed.data.name,
      parsed.data.slug,
    );
    return res.status(201).json({ team });
  } catch (error) {
    return res.status(401).json({ error: error instanceof Error ? error.message : "Unauthorized" });
  }
});

apiRouter.get("/sources", (req, res) => {
  const teamId = String(req.query.teamId ?? "");
  if (!teamId) {
    return res.status(400).json({ error: "teamId is required" });
  }
  return res.json({ sources: teamService.listSources(teamId) });
});

apiRouter.post("/sources", (req, res) => {
  const parsed = createSourceSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  const source = teamService.createSource(parsed.data.teamId, parsed.data.name, parsed.data.type);
  return res.status(201).json({ source });
});

apiRouter.post("/ingest/:sourceId", (req, res) => {
  const parsed = ingestSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  try {
    const response = ingestionService.ingest(req.params.sourceId, parsed.data);
    return res.status(202).json(response);
  } catch (error) {
    return res.status(404).json({ error: error instanceof Error ? error.message : "Ingest failed" });
  }
});

apiRouter.post("/logs/search", (req, res) => {
  const parsed = searchSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  return res.json(queryService.search(parsed.data));
});

apiRouter.get("/logs", (req, res) => {
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
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  return res.json(queryService.search(parsed.data));
});

apiRouter.post("/query/natural", (req, res) => {
  const parsed = naturalQuerySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  return res.json(queryService.explainNaturalQuery(parsed.data.teamId, parsed.data.query));
});

apiRouter.get("/alerts/rules", (req, res) => {
  const teamId = String(req.query.teamId ?? "");
  if (!teamId) {
    return res.status(400).json({ error: "teamId is required" });
  }
  return res.json({ rules: alertService.listRules(teamId) });
});

apiRouter.get("/alerts/incidents", (req, res) => {
  const teamId = String(req.query.teamId ?? "");
  if (!teamId) {
    return res.status(400).json({ error: "teamId is required" });
  }
  return res.json({ incidents: alertService.listIncidents(teamId) });
});

apiRouter.get("/dashboards/overview", (req, res) => {
  const teamId = String(req.query.teamId ?? "");
  if (!teamId) {
    return res.status(400).json({ error: "teamId is required" });
  }
  return res.json({ overview: dashboardService.getOverview(teamId) });
});

apiRouter.get("/stream/logs", (req, res) => {
  const teamId = String(req.query.teamId ?? "");
  if (!teamId) {
    return res.status(400).json({ error: "teamId is required" });
  }
  const unsubscribe = streamingService.subscribe(teamId, res);
  req.on("close", unsubscribe);
});

