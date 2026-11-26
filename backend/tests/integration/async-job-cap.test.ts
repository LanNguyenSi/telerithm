import type { Server } from "node:http";
import supertest from "supertest";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// The cap on pending async query jobs through the real facets, histogram and
// patterns routes and the real QueryService; only the repository below it is
// replaced, so a test decides when a query settles.

const repo = vi.hoisted(() => ({
  getFacets: vi.fn(),
  getHistogram: vi.fn(),
  getPatterns: vi.fn(),
}));

vi.mock("../../src/repositories/log-repository.js", () => ({
  LogRepository: class {
    getFacets = repo.getFacets;
    getHistogram = repo.getHistogram;
    getPatterns = repo.getPatterns;
  },
}));

vi.mock("../../src/ingestion/ingestion-service.js", () => ({
  IngestBatchTooLargeError: class IngestBatchTooLargeError extends Error {},
  IngestionService: class {
    events = { on: vi.fn(), off: vi.fn() };
    ingest = vi.fn();
  },
}));

vi.mock("../../src/utils/password.js", () => ({
  hashPassword: vi.fn(async () => "hash"),
  hashPasswordSync: vi.fn(() => "hash"),
  verifyPassword: vi.fn(async () => true),
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
    asyncJobsMaxInflightPerTeam: 10,
    asyncJobsMaxInflight: 100,
    notificationTestRateLimitWindowMs: 200,
    notificationTestRateLimitMax: 3,
    maxStreamsPerUser: 5,
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
    session: { findUnique: vi.fn(), create: vi.fn(), deleteMany: vi.fn() },
    user: { findUnique: vi.fn(), update: vi.fn() },
    teamMember: { findMany: vi.fn(), findUnique: vi.fn(), delete: vi.fn() },
    alertSubscription: { deleteMany: vi.fn() },
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
  redis: {
    get: vi.fn(),
    set: vi.fn(),
    getdel: vi.fn(),
    keys: vi.fn(),
    del: vi.fn(),
    ping: vi.fn(),
    connect: vi.fn(),
    quit: vi.fn(),
    on: vi.fn(),
  },
  connectRedis: vi.fn(),
  disconnectRedis: vi.fn(),
}));

import { config } from "../../src/config/index.js";
import { prisma } from "../../src/repositories/prisma.js";

type Mock = ReturnType<typeof vi.fn>;
const db = prisma as unknown as {
  session: { findUnique: Mock };
  teamMember: { findUnique: Mock };
};
const caps = config as unknown as {
  asyncJobsMaxInflightPerTeam: number;
  asyncJobsMaxInflight: number;
  maxSyncRuntimeMs: number;
};

let app: supertest.Agent;
let server: Server;

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

type Deferred = { resolve: (value: unknown) => void; reject: (error: Error) => void };
// Every query the repository was asked to run and has not been settled yet.
const open: Deferred[] = [];

function holdQuery(): Promise<unknown> {
  return new Promise((resolve, reject) => {
    open.push({ resolve, reject });
  });
}

const TEAMS = ["t1", "t2", "t3", "t4"];

beforeEach(() => {
  vi.resetAllMocks();
  caps.asyncJobsMaxInflightPerTeam = 10;
  caps.asyncJobsMaxInflight = 100;
  caps.maxSyncRuntimeMs = 1500;
  db.session.findUnique.mockResolvedValue({
    id: "row-1",
    userId: "u1",
    token: "sess_a",
    expiresAt: new Date("2099-01-01T00:00:00.000Z"),
    user: { status: "ACTIVE" },
  });
  db.teamMember.findUnique.mockImplementation(
    async ({ where }: { where: { teamId_userId: { teamId: string; userId: string } } }) =>
      TEAMS.includes(where.teamId_userId.teamId)
        ? { id: "tm", teamId: where.teamId_userId.teamId, userId: "u1", role: "MEMBER" }
        : null,
  );
});

// Settles every held query so no pending job leaks into the next test: the job
// registry lives as long as the router module, that is the whole file.
afterEach(async () => {
  for (const d of open.splice(0)) d.resolve({ facets: [], buckets: [], patterns: [] });
  await new Promise((resolve) => setTimeout(resolve, 5));
});

const ROUTES = [
  { path: "/api/v1/logs/facets", method: "getFacets" as const, body: { fields: ["service"] } },
  { path: "/api/v1/logs/histogram", method: "getHistogram" as const, body: { interval: "5m" } },
  { path: "/api/v1/logs/patterns", method: "getPatterns" as const, body: { groupBy: "service_level" } },
];

function post(path: string, body: Record<string, unknown>) {
  return app
    .post(path)
    .set("Authorization", "Bearer sess_a")
    .send({ teamId: "t1", ...body });
}

describe("async query job cap on the facets, histogram and patterns routes", () => {
  describe.each(ROUTES)("POST $path", ({ path, method, body }) => {
    it("answers 429 with the existing body shape and a Retry-After header once the team cap is reached, without running the query", async () => {
      caps.asyncJobsMaxInflightPerTeam = 2;
      repo[method].mockImplementation(holdQuery);

      expect((await post(path, { ...body, async: true })).status).toBe(202);
      expect((await post(path, { ...body, async: true })).status).toBe(202);
      const refused = await post(path, { ...body, async: true });

      expect(refused.status).toBe(429);
      expect(refused.body).toEqual({
        error: "Too many query jobs in flight for this team, try again shortly",
        retryAfter: 5,
      });
      expect(refused.headers["retry-after"]).toBe("5");
      expect(repo[method]).toHaveBeenCalledTimes(2);
    });

    it("answers 429 up front for a plain request at the cap, before any query starts", async () => {
      caps.asyncJobsMaxInflightPerTeam = 1;
      caps.maxSyncRuntimeMs = 20;
      repo[method].mockImplementation(holdQuery);

      const first = await post(path, body);
      expect(first.status).toBe(202);
      const refused = await post(path, body);

      expect(refused.status).toBe(429);
      expect(refused.body.retryAfter).toBe(5);
      expect(refused.headers["retry-after"]).toBe("5");
      expect(repo[method]).toHaveBeenCalledTimes(1);

      // The job that adopted the first query fails later: that must not surface
      // as an unhandled rejection, and the job reports it.
      open.splice(0)[0]!.reject(new Error("late failure"));
      await new Promise((resolve) => setTimeout(resolve, 5));
      const polled = await app
        .get(`/api/v1/query/jobs/${first.body.requestId}`)
        .set("Authorization", "Bearer sess_a");
      expect(polled.body).toMatchObject({ status: "failed", error: "late failure" });
    });

    it("starts at most the cap's number of queries when plain requests arrive in parallel", async () => {
      caps.asyncJobsMaxInflightPerTeam = 2;
      caps.maxSyncRuntimeMs = 50;
      repo[method].mockImplementation(holdQuery);

      const responses = await Promise.all(Array.from({ length: 6 }, () => post(path, body)));

      const statuses = responses.map((res) => res.status).sort();
      expect(statuses).toEqual([202, 202, 429, 429, 429, 429]);
      expect(repo[method]).toHaveBeenCalledTimes(2);
    });

    it("counts a plain query that is still inside the sync budget against the cap, and frees the slot when it finishes", async () => {
      caps.asyncJobsMaxInflightPerTeam = 1;
      caps.maxSyncRuntimeMs = 1000;
      repo[method].mockImplementation(holdQuery);

      const plain = post(path, body).then((res) => res);
      await vi.waitFor(() => expect(repo[method]).toHaveBeenCalledTimes(1));
      const whileRunning = await post(path, { ...body, async: true });
      expect(repo[method]).toHaveBeenCalledTimes(1);
      open.splice(0)[0]!.resolve({ marker: "inline" });
      const finished = await plain;
      repo[method].mockResolvedValue({ marker: "after" });
      const after = await post(path, { ...body, async: true });

      expect(whileRunning.status).toBe(429);
      expect(finished.status).toBe(200);
      expect(finished.body.marker).toBe("inline");
      expect(after.status).toBe(202);
    });

    it("gives the slot back when the plain query fails, whether the producer rejects or throws", async () => {
      caps.asyncJobsMaxInflightPerTeam = 1;

      repo[method].mockRejectedValueOnce(new Error("clickhouse down"));
      expect((await post(path, body)).status).toBe(500);
      repo[method].mockImplementationOnce(() => {
        throw new Error("sync boom");
      });
      expect((await post(path, body)).status).toBe(500);
      repo[method].mockResolvedValue({ marker: "inline" });

      expect((await post(path, body)).status).toBe(200);
    });

    it("uses one slot per request that falls back to a job", async () => {
      caps.asyncJobsMaxInflightPerTeam = 2;
      caps.maxSyncRuntimeMs = 20;
      repo[method].mockImplementation(holdQuery);

      expect((await post(path, body)).status).toBe(202);
      expect((await post(path, body)).status).toBe(202);

      expect((await post(path, body)).status).toBe(429);
      expect(repo[method]).toHaveBeenCalledTimes(2);
    });

    it("adopts the running query on the fallback: one query per request, and the job serves its result", async () => {
      caps.maxSyncRuntimeMs = 20;
      repo[method].mockImplementation(holdQuery);

      const started = await post(path, body);
      expect(started.status).toBe(202);
      expect(repo[method]).toHaveBeenCalledTimes(1);

      open[0]!.resolve({ marker: "from-the-sync-query" });
      await new Promise((resolve) => setTimeout(resolve, 5));
      const polled = await app
        .get(`/api/v1/query/jobs/${started.body.requestId}`)
        .set("Authorization", "Bearer sess_a");

      expect(repo[method]).toHaveBeenCalledTimes(1);
      expect(polled.status).toBe(200);
      expect(polled.body.status).toBe("completed");
      expect(polled.body.data).toEqual({ marker: "from-the-sync-query" });
    });

    it("answers 200 inline for plain requests inside the sync budget, one after the other at a cap of 1", async () => {
      caps.asyncJobsMaxInflightPerTeam = 1;
      caps.asyncJobsMaxInflight = 1;
      repo[method].mockResolvedValue({ marker: "inline" });

      const first = await post(path, body);
      const second = await post(path, body);

      expect(first.status).toBe(200);
      expect(first.body).toMatchObject({ partial: false, cached: false, marker: "inline" });
      expect(second.status).toBe(200);
    });

    it("frees the slot when the query of a pending job completes", async () => {
      caps.asyncJobsMaxInflightPerTeam = 1;
      repo[method].mockImplementation(holdQuery);
      expect((await post(path, { ...body, async: true })).status).toBe(202);
      expect((await post(path, { ...body, async: true })).status).toBe(429);

      open[0]!.resolve({});
      await new Promise((resolve) => setTimeout(resolve, 5));

      expect((await post(path, { ...body, async: true })).status).toBe(202);
    });

    it("keeps a second team's requests unaffected by the first team's full cap", async () => {
      caps.asyncJobsMaxInflightPerTeam = 1;
      repo[method].mockImplementation(holdQuery);
      expect((await post(path, { ...body, async: true })).status).toBe(202);
      expect((await post(path, { ...body, async: true })).status).toBe(429);

      const other = await post(path, { ...body, teamId: "t2", async: true });

      expect(other.status).toBe(202);
    });

    it("answers 429 with the process message when the process cap is reached by other teams", async () => {
      caps.asyncJobsMaxInflight = 2;
      repo[method].mockImplementation(holdQuery);
      expect((await post(path, { ...body, teamId: "t1", async: true })).status).toBe(202);
      expect((await post(path, { ...body, teamId: "t2", async: true })).status).toBe(202);

      const refused = await post(path, { ...body, teamId: "t3", async: true });

      expect(refused.status).toBe(429);
      expect(refused.body.error).toBe("The server is busy with query jobs, try again shortly");
    });
  });

  it("counts the pending jobs of the three routes together toward one team cap", async () => {
    caps.asyncJobsMaxInflightPerTeam = 3;
    for (const route of ROUTES) repo[route.method].mockImplementation(holdQuery);

    for (const route of ROUTES) {
      expect((await post(route.path, { ...route.body, async: true })).status).toBe(202);
    }
    const refused = await post(ROUTES[0]!.path, { ...ROUTES[0]!.body, async: true });

    expect(refused.status).toBe(429);
  });
});
