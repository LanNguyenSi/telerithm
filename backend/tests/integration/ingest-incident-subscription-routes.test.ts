import type { Server } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import supertest from "supertest";

// Route-level tests for three behaviours that need their own app instance: the
// shared api.test.ts app sits close to the global 200 requests/minute limiter,
// so requests added there would turn unrelated tests into 429s.
//   - POST /ingest/:sourceId/raw body parsing and POST /ingest/:sourceId with a
//     bare JSON array (what Fluentd and Vector send)
//   - incident actions answering 409 for a transition the status does not allow
//   - subscription create and update rejecting the EMAIL channel

const { mockIngest } = vi.hoisted(() => ({ mockIngest: vi.fn() }));

vi.mock("../../src/ingestion/ingestion-service.js", () => ({
  IngestionService: class {
    events = { on: vi.fn(), off: vi.fn(), emit: vi.fn() };
    ingest = mockIngest;
  },
}));

vi.mock("../../src/config/index.js", () => ({
  config: {
    port: 4000,
    host: "127.0.0.1",
    nodeEnv: "test",
    databaseUrl: "postgresql://test:test@localhost:5432/test",
    clickhouseUrl: "http://localhost:8123",
    logLevel: "silent",
    corsOrigins: "*",
    redisUrl: "redis://localhost:6379",
    multiTenant: false,
    registrationMode: "approval",
    adminEmail: "admin@test.com",
    openaiApiKey: undefined,
    maxLookbackMs: 7 * 24 * 60 * 60 * 1000,
    maxPageSize: 500,
    maxSyncRuntimeMs: 1500,
    notificationTestRateLimitWindowMs: 200,
    notificationTestRateLimitMax: 3,
  },
}));

vi.mock("../../src/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), fatal: vi.fn() },
  createChildLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

vi.mock("../../src/repositories/prisma.js", () => ({
  prisma: {
    $queryRaw: vi.fn(),
    $transaction: vi.fn(),
    session: { findUnique: vi.fn() },
    teamMember: { findUnique: vi.fn() },
    logSource: { findUnique: vi.fn() },
    alertIncident: { findUnique: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
    incidentEvent: { create: vi.fn() },
    alertSubscription: { create: vi.fn(), update: vi.fn() },
    alertRule: { findFirst: vi.fn() },
  },
  connectDatabase: vi.fn(),
  disconnectDatabase: vi.fn(),
}));

vi.mock("../../src/repositories/clickhouse.js", () => ({
  clickhouse: { ping: vi.fn(), query: vi.fn(), insert: vi.fn(), close: vi.fn() },
  connectClickHouse: vi.fn(),
  disconnectClickHouse: vi.fn(),
}));

vi.mock("../../src/repositories/redis.js", () => ({
  redis: { get: vi.fn(), set: vi.fn(), keys: vi.fn(), del: vi.fn(), ping: vi.fn(), connect: vi.fn(), quit: vi.fn(), on: vi.fn() },
  connectRedis: vi.fn(),
  disconnectRedis: vi.fn(),
}));

import { prisma } from "../../src/repositories/prisma.js";

type Mock = ReturnType<typeof vi.fn>;
const db = prisma as unknown as {
  $transaction: Mock;
  session: { findUnique: Mock };
  teamMember: { findUnique: Mock };
  logSource: { findUnique: Mock };
  alertIncident: { findUnique: Mock; findFirst: Mock; update: Mock };
  incidentEvent: { create: Mock };
  alertSubscription: { create: Mock; update: Mock };
  alertRule: { findFirst: Mock };
};

let server: Server;
let app: supertest.Agent;

beforeAll(async () => {
  const { createApp } = await import("../../src/app.js");
  server = await new Promise<Server>((resolve, reject) => {
    const s = createApp().listen(0);
    s.once("listening", () => resolve(s));
    s.once("error", reject);
  });
  app = supertest(server);
});

afterAll(async () => {
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  vi.resetAllMocks();
  db.$transaction.mockImplementation(async (ops: Array<Promise<unknown>>) => Promise.all(ops));
  db.session.findUnique.mockResolvedValue({
    id: "session-1",
    userId: "user-1",
    token: "sess_member",
    expiresAt: new Date("2099-01-01T00:00:00.000Z"),
  });
  db.teamMember.findUnique.mockResolvedValue({
    id: "m1",
    teamId: "t1",
    userId: "user-1",
    role: "MEMBER",
    joinedAt: new Date("2026-03-23T00:00:00.000Z"),
  });
  db.logSource.findUnique.mockResolvedValue({ id: "src-1", teamId: "t1", name: "src", apiKey: "lf_key" });
  mockIngest.mockResolvedValue({ accepted: 2, rejected: 0, errors: [], batchId: "b1" });
});

const auth = { Authorization: "Bearer sess_member" };

describe("POST /api/v1/ingest/:sourceId/raw", () => {
  const raw = () => app.post("/api/v1/ingest/src-1/raw").set("X-API-Key", "lf_key");

  it("splits a text/plain body into one log line per line and ingests the lines as raw strings", async () => {
    const res = await raw().set("Content-Type", "text/plain").send("first line\nsecond line\n");

    expect(res.status).toBe(202);
    expect(res.body).toEqual({ accepted: 2, rejected: 0, errors: [], batchId: "b1" });
    expect(mockIngest).toHaveBeenCalledExactlyOnceWith("src-1", { logs: ["first line", "second line"] });
  });

  it("treats CRLF line ends like LF and drops blank lines", async () => {
    const res = await raw().set("Content-Type", "text/plain").send("a\r\n\r\n  \r\nb\r\n");

    expect(res.status).toBe(202);
    expect(mockIngest).toHaveBeenCalledWith("src-1", { logs: ["a", "b"] });
  });

  it("accepts a charset parameter and keeps multi-byte characters intact", async () => {
    const res = await raw().set("Content-Type", "text/plain; charset=utf-8").send("grüße aus köln");

    expect(res.status).toBe(202);
    expect(mockIngest).toHaveBeenCalledWith("src-1", { logs: ["grüße aus köln"] });
  });

  it("rejects a JSON body with 415 instead of ingesting a stringified object", async () => {
    const res = await raw().set("Content-Type", "application/json").send({ message: "x" });

    expect(res.status).toBe(415);
    expect(res.body.error).toBe("Content-Type must be text/plain");
    expect(mockIngest).not.toHaveBeenCalled();
  });

  it("rejects the content type curl -d sends by default (form-urlencoded) with 415", async () => {
    const res = await raw().set("Content-Type", "application/x-www-form-urlencoded").send("plain=line");

    expect(res.status).toBe(415);
    expect(mockIngest).not.toHaveBeenCalled();
  });

  it("answers 400 for an empty body and for a body of blank lines", async () => {
    const empty = await raw().set("Content-Type", "text/plain");
    expect(empty.status).toBe(400);
    expect(empty.body.error).toBe("Empty body");

    const blank = await raw().set("Content-Type", "text/plain").send("\n  \n");
    expect(blank.status).toBe(400);
    expect(blank.body.error).toBe("Empty body");
    expect(mockIngest).not.toHaveBeenCalled();
  });

  it("checks the API key before the body is looked at", async () => {
    const res = await app.post("/api/v1/ingest/src-1/raw").set("Content-Type", "text/plain").send("line");

    expect(res.status).toBe(401);
    expect(mockIngest).not.toHaveBeenCalled();
  });

  it("answers 404 when the source does not exist", async () => {
    mockIngest.mockRejectedValue(new Error("Source not found"));

    const res = await raw().set("Content-Type", "text/plain").send("line");

    expect(res.status).toBe(404);
    expect(res.body.error).toBe("Source not found");
  });
});

describe("POST /api/v1/ingest/:sourceId with a bare JSON array", () => {
  const ingest = () => app.post("/api/v1/ingest/src-1").set("X-API-Key", "lf_key");

  it("treats an array body as the logs list of the envelope", async () => {
    const events = [{ message: "from fluentd", level: "error" }, "a raw string"];

    const res = await ingest().send(events);

    expect(res.status).toBe(202);
    expect(mockIngest).toHaveBeenCalledExactlyOnceWith("src-1", { logs: events });
  });

  it("still accepts the { logs: [...] } envelope", async () => {
    const res = await ingest().send({ logs: ["x"], format: "plain", batchId: "b-9" });

    expect(res.status).toBe(202);
    expect(mockIngest).toHaveBeenCalledWith("src-1", { logs: ["x"], format: "plain", batchId: "b-9" });
  });

  it("rejects an empty array and an array with an invalid entry with 400", async () => {
    expect((await ingest().send([])).status).toBe(400);
    expect((await ingest().send([{ level: "loud", message: "x" }])).status).toBe(400);
    expect(mockIngest).not.toHaveBeenCalled();
  });
});

describe("incident actions reject transitions the current status does not allow", () => {
  function arrange(status: string) {
    db.alertIncident.findUnique.mockResolvedValue({ rule: { teamId: "t1" } });
    db.alertIncident.findFirst.mockResolvedValue({ id: "inc-1", status });
    db.alertIncident.update.mockResolvedValue({ id: "inc-1", status: "UPDATED" });
    db.incidentEvent.create.mockResolvedValue({ id: "ev-1" });
  }
  const post = (action: string) => app.post(`/api/v1/alerts/incidents/inc-1/${action}`).set(auth).send({});

  it.each([
    ["acknowledge", "RESOLVED"],
    ["acknowledge", "ACKNOWLEDGED"],
    ["resolve", "RESOLVED"],
    ["reopen", "OPEN"],
  ])("%s on a %s incident answers 409 with the reason and writes nothing", async (action, status) => {
    arrange(status);

    const res = await post(action);

    expect(res.status).toBe(409);
    expect(res.body.error).toContain(`Cannot ${action} an incident that is ${status}`);
    expect(db.alertIncident.update).not.toHaveBeenCalled();
    expect(db.incidentEvent.create).not.toHaveBeenCalled();
  });

  it.each([
    ["acknowledge", "OPEN"],
    ["resolve", "OPEN"],
    ["resolve", "ACKNOWLEDGED"],
    ["reopen", "RESOLVED"],
    ["reopen", "ACKNOWLEDGED"],
  ])("%s on a %s incident succeeds", async (action, status) => {
    arrange(status);

    const res = await post(action);

    expect(res.status).toBe(200);
    expect(db.alertIncident.update).toHaveBeenCalledOnce();
    expect(db.incidentEvent.create).toHaveBeenCalledOnce();
  });

  it("answers 409 when the status changed between the check and the write", async () => {
    arrange("OPEN");
    db.$transaction.mockRejectedValue(Object.assign(new Error("Record to update not found."), { code: "P2025" }));

    const res = await post("resolve");

    expect(res.status).toBe(409);
    expect(res.body.error).toContain("changed concurrently");
  });
});

describe("subscriptions: the EMAIL channel is rejected until an email transport exists", () => {
  it("POST /subscriptions with channel EMAIL answers 400 naming the reason, nothing is created", async () => {
    const res = await app.post("/api/v1/subscriptions").set(auth).send({ teamId: "t1", channel: "EMAIL", config: {} });

    expect(res.status).toBe(400);
    expect(res.body.error.fieldErrors.channel).toEqual([
      expect.stringContaining("EMAIL subscriptions are not supported yet because no email transport is configured"),
    ]);
    expect(db.alertSubscription.create).not.toHaveBeenCalled();
  });

  it("PUT /subscriptions/:id switching the channel to EMAIL answers 400, nothing is updated", async () => {
    const res = await app.put("/api/v1/subscriptions/sub-1").set(auth).send({ channel: "EMAIL" });

    expect(res.status).toBe(400);
    expect(res.body.error.fieldErrors.channel).toEqual([expect.stringContaining("EMAIL subscriptions are not supported yet")]);
    expect(db.alertSubscription.update).not.toHaveBeenCalled();
  });

  it("PUT /subscriptions/:id without a channel still updates an existing EMAIL subscription", async () => {
    db.alertSubscription.update.mockResolvedValue({ id: "sub-1", channel: "EMAIL", enabled: false });

    const res = await app.put("/api/v1/subscriptions/sub-1").set(auth).send({ enabled: false });

    expect(res.status).toBe(200);
    expect(res.body.subscription.channel).toBe("EMAIL");
    expect(db.alertSubscription.update).toHaveBeenCalledOnce();
  });

  it.each(["WEBHOOK", "SLACK", "MSTEAMS"])("POST /subscriptions with %s is accepted", async (channel) => {
    db.alertSubscription.create.mockResolvedValue({ id: "sub-2", channel });

    const res = await app.post("/api/v1/subscriptions").set(auth).send({ teamId: "t1", channel, config: {} });

    expect(res.status).toBe(201);
    expect(db.alertSubscription.create).toHaveBeenCalledOnce();
  });
});

describe("POST /subscriptions: ruleId must belong to the body's team", () => {
  const body = { teamId: "t1", ruleId: "rule-1", channel: "WEBHOOK", config: {} };

  it("creates a subscription for a rule of the same team, looked up scoped to that team", async () => {
    db.alertRule.findFirst.mockResolvedValue({ id: "rule-1" });
    db.alertSubscription.create.mockResolvedValue({ id: "sub-3", ruleId: "rule-1" });

    const res = await app.post("/api/v1/subscriptions").set(auth).send(body);

    expect(res.status).toBe(201);
    expect(db.alertRule.findFirst).toHaveBeenCalledWith({
      where: { id: "rule-1", teamId: "t1" },
      select: { id: true },
    });
    expect(db.alertSubscription.create).toHaveBeenCalledOnce();
  });

  it("answers 404 for a rule of another team (the scoped lookup finds nothing), nothing is created", async () => {
    db.alertRule.findFirst.mockResolvedValue(null);

    const res = await app.post("/api/v1/subscriptions").set(auth).send(body);

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "Alert rule not found" });
    expect(db.alertSubscription.create).not.toHaveBeenCalled();
  });

  it("answers the same 404 body for a nonexistent rule as for a foreign one", async () => {
    db.alertRule.findFirst.mockResolvedValue(null);
    const foreign = await app.post("/api/v1/subscriptions").set(auth).send(body);
    const missing = await app
      .post("/api/v1/subscriptions")
      .set(auth)
      .send({ ...body, ruleId: "does-not-exist" });

    expect(missing.status).toBe(foreign.status);
    expect(missing.body).toEqual(foreign.body);
  });

  it("does not look up a rule for a team-wide subscription without ruleId", async () => {
    db.alertSubscription.create.mockResolvedValue({ id: "sub-4" });

    const res = await app.post("/api/v1/subscriptions").set(auth).send({ teamId: "t1", channel: "WEBHOOK", config: {} });

    expect(res.status).toBe(201);
    expect(db.alertRule.findFirst).not.toHaveBeenCalled();
  });
});
