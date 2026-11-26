import type { Server } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import supertest from "supertest";

// The per-user rate limit for natural-language (LLM-backed) queries:
// naturalQueryLimiter in backend/src/api/rest/router.ts, gated onto the
// three routes that can reach the model - POST /query/natural, POST
// /logs/search with queryType "natural" and GET /logs?queryType=natural.
// One shared bucket per user across those three paths; SQL search (absent
// or "sql" queryType) is never counted and never limited by it.
//
// Mocked limits: max 5 requests per 1000 ms window. These deliberately
// differ from the shipped defaults (20 per 60000 ms, pinned by the last
// test through the real config module): if the limiter read its numbers
// from literals instead of config, the drain tests here would not 429
// where they expect to.
//
// Every authenticated probe asks for team "t-probe", and the teamMember
// mock answers every membership lookup with "no membership", so a request
// that clears the limiter reaches requireTeamRole and answers 403
// Forbidden. A 403 therefore proves "the handler ran" (counted or not,
// per the probe's query type), and only the limiter can answer 429; the
// query service, the LLM and ClickHouse are never involved.

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
    naturalQueryRateLimitWindowMs: 1000,
    naturalQueryRateLimitMax: 5,
    // One trusted hop, so an X-Forwarded-For value moves req.ip: used by
    // the "one user from two IPs" test. With it unset, req.ip is the
    // socket peer and every request here would share one IP.
    trustProxy: 1 as number | undefined,
    metricsToken: undefined as string | undefined,
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

import { prisma } from "../../src/repositories/prisma.js";

type Mock = ReturnType<typeof vi.fn>;
const mockedPrisma = prisma as unknown as {
  session: { findUnique: Mock };
  teamMember: { findUnique: Mock };
};

const WINDOW_MS = 1000;
const MAX = 5;
const LIMIT_MESSAGE = "Too many natural-language queries, try again later";

// Each test works with its own user id: the limiter is a module-level
// singleton whose buckets live for the whole file run, so a shared id (or
// an id reused from another test) would make pass/fail depend on order.
// "127.0.0.1" is the socket peer of every supertest request.
const TOKENS: Record<string, string> = {
  "tok-limit": "nq-user-limit",
  "tok-sql": "nq-user-sql",
  "tok-shared": "nq-user-shared",
  "tok-user-a": "nq-user-a",
  "tok-user-b": "nq-user-b",
  "tok-two-ips": "nq-user-two-ips",
  // Two sessions (tokens) of ONE user id: they must share one bucket.
  "tok-device-a": "nq-user-two-devices",
  "tok-device-b": "nq-user-two-devices",
  "tok-reset": "nq-user-reset",
  "tok-unauth-probe": "nq-user-unauth-probe",
  "tok-invalid": "nq-user-invalid",
};

function authed(request: supertest.Test, token: string): supertest.Test {
  return request.set("Authorization", `Bearer ${token}`);
}

// Natural probes: all three answer 403 (no membership) once the request
// clears the limiter. The POST /logs/search body is valid apart from the
// missing membership, so the 403 is the route's furthest reachable answer
// without involving the query service.
function searchNatural(token: string, xff?: string) {
  const request = authed(app.post("/api/v1/logs/search"), token).send({
    teamId: "t-probe",
    queryType: "natural",
    query: "why did checkout fail",
  });
  return xff ? request.set("X-Forwarded-For", xff) : request;
}
function getNatural(token: string, xff?: string) {
  const request = authed(
    app.get("/api/v1/logs?teamId=t-probe&queryType=natural&query=why%20did%20checkout%20fail"),
    token,
  );
  return xff ? request.set("X-Forwarded-For", xff) : request;
}
function explainNatural(token: string, xff?: string) {
  const request = authed(app.post("/api/v1/query/natural"), token).send({
    teamId: "t-probe",
    query: "why did checkout fail",
  });
  return xff ? request.set("X-Forwarded-For", xff) : request;
}
// SQL equivalents of the two search paths: same routes, but the default
// query type, which must never touch the bucket.
function searchSql(token: string) {
  return authed(app.post("/api/v1/logs/search"), token).send({
    teamId: "t-probe",
    queryType: "sql",
    query: "checkout",
  });
}
// POST /logs/search with the queryType key absent: the handler defaults it to
// "sql", so the body gate must pass the request through uncounted too.
function searchUnset(token: string) {
  return authed(app.post("/api/v1/logs/search"), token).send({ teamId: "t-probe", query: "checkout" });
}
function getUnset(token: string) {
  return authed(app.get("/api/v1/logs?teamId=t-probe&query=checkout"), token);
}

let server: Server;
let app: supertest.Agent;

beforeAll(async () => {
  const { createApp } = await import("../../src/app.js");
  // One persistent listening server (see the long comment in api.test.ts:
  // per-request listen(0) churn races the OS into parse errors under load).
  server = await new Promise<Server>((resolve, reject) => {
    const s = createApp().listen(0);
    s.once("listening", () => resolve(s));
    s.once("error", reject);
  });
  app = supertest(server);
});

afterAll(async () => {
  if (!server) return;
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
});

beforeEach(() => {
  vi.resetAllMocks();
  mockedPrisma.session.findUnique.mockImplementation(async (args: { where: { token: string } }) => {
    const userId = TOKENS[args.where.token];
    if (!userId) return null;
    return {
      id: `session-${userId}`,
      userId,
      token: args.where.token,
      expiresAt: new Date("2099-01-01T00:00:00.000Z"),
      user: { status: "ACTIVE" },
    };
  });
  // No membership anywhere: every request that clears the limiter ends in
  // requireTeamRole's 403, never in the query service.
  mockedPrisma.teamMember.findUnique.mockResolvedValue(null);
});

describe("natural-query rate limit", () => {
  it("passes requests up to the configured max, answers 429 at max+1 with the rateLimitHandler body", async () => {
    for (let i = 0; i < MAX; i++) {
      const res = await explainNatural("tok-limit");
      expect(res.status).toBe(403);
    }
    const blocked = await explainNatural("tok-limit");
    expect(blocked.status).toBe(429);
    expect(blocked.body).toEqual({ error: LIMIT_MESSAGE, retryAfter: expect.any(Number) });
    expect(Number.isInteger(blocked.body.retryAfter)).toBe(true);
    expect(blocked.body.retryAfter).toBeGreaterThanOrEqual(1);
    expect(blocked.headers["retry-after"]).toBeDefined();
    // The 429 comes from the limiter: the handler (and its membership
    // lookup) never runs for the blocked request.
    expect(mockedPrisma.teamMember.findUnique).toHaveBeenCalledTimes(MAX);
  });

  it("SQL search is never counted and never limited: past the max it still reaches the handler, and the natural budget is untouched", async () => {
    // 3x the natural max on every SQL shape: queryType "sql", queryType
    // absent on POST /logs/search (the schema defaults it to "sql"), and
    // GET /logs without queryType. Every request reaches the handler
    // instead of the limiter.
    for (let i = 0; i < MAX * 3; i++) {
      expect((await searchSql("tok-sql")).status).toBe(403);
      expect((await searchUnset("tok-sql")).status).toBe(403);
      expect((await getUnset("tok-sql")).status).toBe(403);
    }
    // Not one slot of the natural budget was consumed by the SQL traffic.
    for (let i = 0; i < MAX; i++) {
      expect((await searchNatural("tok-sql")).status).toBe(403);
    }
    expect((await searchNatural("tok-sql")).status).toBe(429);
  });

  it("the three natural paths drain one shared bucket per user", async () => {
    // Drain the bucket one request per path, in mixed order.
    expect((await explainNatural("tok-shared")).status).toBe(403);
    expect((await searchNatural("tok-shared")).status).toBe(403);
    expect((await getNatural("tok-shared")).status).toBe(403);
    expect((await searchNatural("tok-shared")).status).toBe(403);
    expect((await getNatural("tok-shared")).status).toBe(403);
    // The 6th request on ANY of the three paths is rejected by the limiter.
    expect((await explainNatural("tok-shared")).status).toBe(429);
    expect((await getNatural("tok-shared")).status).toBe(429);
    expect((await searchNatural("tok-shared")).status).toBe(429);
  });

  it("two users behind one IP get separate buckets", async () => {
    // Both tokens are requested from the same socket peer (127.0.0.1, no
    // forwarded header): keying on the IP would leave user B in user A's
    // exhausted bucket.
    for (let i = 0; i < MAX; i++) {
      expect((await explainNatural("tok-user-a")).status).toBe(403);
    }
    expect((await explainNatural("tok-user-a")).status).toBe(429);
    expect((await explainNatural("tok-user-b")).status).toBe(403);
    expect((await searchNatural("tok-user-b")).status).toBe(403);
  });

  it("one user with two sessions (tokens) shares one bucket: the max+1th request across both answers 429", async () => {
    // The limiter keys on the resolved user id, not on the presented token or
    // session: keying on the Authorization header would hand each of these
    // tokens its own budget, so one user could multiply the budget simply by
    // opening more sessions. Interleaved, so no single token ever uses more
    // than ceil(MAX/2) slots on its own; the 6th request of either token is
    // rejected only because the shared per-user bucket is already full.
    for (let i = 0; i < MAX; i++) {
      const token = i % 2 === 0 ? "tok-device-a" : "tok-device-b";
      expect((await explainNatural(token)).status).toBe(403);
    }
    // The 6th request ran out of budget: no membership lookup behind it.
    expect(mockedPrisma.teamMember.findUnique).toHaveBeenCalledTimes(MAX);
    expect((await explainNatural("tok-device-a")).status).toBe(429);
    expect((await searchNatural("tok-device-b")).status).toBe(429);
    // A third session of the same user is born blocked.
    expect((await getNatural("tok-device-a")).status).toBe(429);
  });

  it("one user from two IPs shares one bucket", async () => {
    // Different forwarded client addresses, same user id: keying on the
    // IP would hand out a fresh bucket with every new address.
    expect((await explainNatural("tok-two-ips", "203.0.113.1")).status).toBe(403);
    expect((await explainNatural("tok-two-ips", "203.0.113.2")).status).toBe(403);
    expect((await explainNatural("tok-two-ips", "203.0.113.1")).status).toBe(403);
    expect((await explainNatural("tok-two-ips", "203.0.113.2")).status).toBe(403);
    expect((await explainNatural("tok-two-ips", "203.0.113.1")).status).toBe(403);
    expect((await explainNatural("tok-two-ips", "203.0.113.2")).status).toBe(429);
    expect((await explainNatural("tok-two-ips", "203.0.113.3")).status).toBe(429);
  });

  it("an unauthenticated natural request answers 401 (never 429) and never creates a bucket", async () => {
    // More than a full budget of unauthenticated natural requests, no
    // header and garbage tokens: every one gets 401 from the handler's
    // requireAuth, and the limiter (which runs behind the resolved
    // caller) never sees them. If the limiter ran before auth, request
    // MAX+1 would answer 429 here instead of 401.
    for (let i = 0; i < MAX + 1; i++) {
      expect((await app.post("/api/v1/query/natural").send({ teamId: "t-probe", query: "why" })).status).toBe(
        401,
      );
      const garbage = await authed(app.post("/api/v1/logs/search"), "tok-does-not-exist").send({
        teamId: "t-probe",
        queryType: "natural",
        query: "why did checkout fail",
      });
      expect(garbage.status).toBe(401);
      expect((await app.get("/api/v1/logs?teamId=t-probe&queryType=natural&query=why")).status).toBe(401);
    }
    // A real user behind the same IP keeps the full budget.
    for (let i = 0; i < MAX; i++) {
      expect((await explainNatural("tok-unauth-probe")).status).toBe(403);
    }
    expect((await explainNatural("tok-unauth-probe")).status).toBe(429);
  });

  it("a natural request with an invalid body is counted (documented): the 400s drain the bucket", async () => {
    // Documented choice: the gate counts the request as soon as it asks
    // for queryType "natural", before schema validation, so 400-spam on
    // the natural paths consumes budget too (see docs/api.md).
    for (let i = 0; i < MAX; i++) {
      const res = await authed(app.post("/api/v1/logs/search"), "tok-invalid").send({
        queryType: "natural",
      });
      expect(res.status).toBe(400);
    }
    const valid = await searchNatural("tok-invalid");
    expect(valid.status).toBe(429);
  });

  it("a natural request after the window resets passes", async () => {
    for (let i = 0; i < MAX; i++) {
      expect((await explainNatural("tok-reset")).status).toBe(403);
    }
    expect((await explainNatural("tok-reset")).status).toBe(429);
    await new Promise((resolve) => setTimeout(resolve, WINDOW_MS + 100));
    expect((await explainNatural("tok-reset")).status).toBe(403);
  }, 10_000);

  it("the shipped config defaults are 60000 ms and 20 requests per window", async () => {
    // Loads the REAL config module (bypassing the mock above) with the
    // limit variables unset, so this pins the defaults the docs state.
    const saved: Record<string, string | undefined> = {
      DATABASE_URL: process.env.DATABASE_URL,
      CLICKHOUSE_URL: process.env.CLICKHOUSE_URL,
      NATURAL_QUERY_RATE_LIMIT_WINDOW_MS: process.env.NATURAL_QUERY_RATE_LIMIT_WINDOW_MS,
      NATURAL_QUERY_RATE_LIMIT_MAX: process.env.NATURAL_QUERY_RATE_LIMIT_MAX,
    };
    try {
      process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
      process.env.CLICKHOUSE_URL = "http://localhost:8123";
      delete process.env.NATURAL_QUERY_RATE_LIMIT_WINDOW_MS;
      delete process.env.NATURAL_QUERY_RATE_LIMIT_MAX;
      const actual =
        await vi.importActual<typeof import("../../src/config/index.js")>("../../src/config/index.js");
      expect(actual.config.naturalQueryRateLimitWindowMs).toBe(60_000);
      expect(actual.config.naturalQueryRateLimitMax).toBe(20);
    } finally {
      for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
    }
  });
});
