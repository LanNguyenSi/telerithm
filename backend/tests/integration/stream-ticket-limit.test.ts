import type { Server } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import supertest from "supertest";

// The per-user rate limit on POST /stream/ticket (streamTicketLimiter in
// backend/src/api/rest/router.ts). The limit is mocked to 3 requests per
// 60 s. Each test uses its own user ids, so a bucket never carries over from
// one test to the next (the window is longer than the run). Own app instance,
// to stay clear of the shared app's rate-limit budget.

vi.mock("../../src/ingestion/ingestion-service.js", () => ({
  IngestBatchTooLargeError: class IngestBatchTooLargeError extends Error {},
  IngestionService: class {
    events = { on: vi.fn(), off: vi.fn(), emit: vi.fn() };
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
    notificationTestRateLimitWindowMs: 60_000,
    notificationTestRateLimitMax: 1000,
    streamTicketRateLimitWindowMs: 60_000,
    streamTicketRateLimitMax: 3,
    naturalQueryRateLimitWindowMs: 60_000,
    naturalQueryRateLimitMax: 1000,
    alertRulesMaxPerTeam: 100,
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
    set: vi.fn(async () => "OK"),
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
const db = prisma as unknown as {
  session: { findUnique: Mock };
  teamMember: { findUnique: Mock };
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

// token -> user id; every user is an ACTIVE member of team "t1".
const sessions = new Map<string, string>();

beforeEach(() => {
  sessions.clear();
  db.session.findUnique.mockReset();
  db.teamMember.findUnique.mockReset();
  db.session.findUnique.mockImplementation(async ({ where }: { where: { token?: string } }) => {
    const userId = where.token === undefined ? undefined : sessions.get(where.token);
    if (userId === undefined) return null;
    return {
      id: `row-${where.token}`,
      userId,
      token: where.token,
      expiresAt: new Date("2099-01-01T00:00:00.000Z"),
      user: { status: "ACTIVE" },
    };
  });
  db.teamMember.findUnique.mockImplementation(
    async ({ where }: { where: { teamId_userId: { teamId: string; userId: string } } }) => {
      const { teamId, userId } = where.teamId_userId;
      return teamId === "t1" ? { id: "tm", teamId, userId, role: "MEMBER" } : null;
    },
  );
});

const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
const ticket = (token: string, body: unknown = { teamId: "t1" }) =>
  app
    .post("/api/v1/stream/ticket")
    .set(bearer(token))
    .send(body as object);

describe("POST /stream/ticket per-user rate limit", () => {
  it("answers 429 { error, retryAfter } with Retry-After on the request after the limit", async () => {
    sessions.set("tok_shape", "u-shape");
    for (let i = 0; i < 3; i += 1) expect((await ticket("tok_shape")).status).toBe(201);

    const res = await ticket("tok_shape");
    expect(res.status).toBe(429);
    expect(res.body.error).toBe("Too many stream tickets, try again later");
    expect(res.body.retryAfter).toBeGreaterThanOrEqual(1);
    expect(res.body.retryAfter).toBeLessThanOrEqual(60);
    expect(res.headers["retry-after"]).toBeDefined();
  });

  it("keeps the handler's answers under the limit: 201 no-store, 400 and 403", async () => {
    sessions.set("tok_ok", "u-ok");
    const issued = await ticket("tok_ok");
    expect(issued.status).toBe(201);
    expect(issued.headers["cache-control"]).toBe("no-store");
    expect(typeof issued.body.ticket).toBe("string");
    expect((await ticket("tok_ok", {})).status).toBe(400);
    expect((await ticket("tok_ok", { teamId: "other-team" })).status).toBe(403);
  });

  it("shares one bucket between two sessions of the same user", async () => {
    sessions.set("tok_dev1", "u-shared");
    sessions.set("tok_dev2", "u-shared");
    expect((await ticket("tok_dev1")).status).toBe(201);
    expect((await ticket("tok_dev2")).status).toBe(201);
    expect((await ticket("tok_dev1")).status).toBe(201);
    expect((await ticket("tok_dev2")).status).toBe(429);
    expect((await ticket("tok_dev1")).status).toBe(429);
  });

  it("gives another user a separate bucket", async () => {
    sessions.set("tok_heavy", "u-heavy");
    sessions.set("tok_light", "u-light");
    for (let i = 0; i < 3; i += 1) await ticket("tok_heavy");
    expect((await ticket("tok_heavy")).status).toBe(429);
    expect((await ticket("tok_light")).status).toBe(201);
  });

  it("answers 401 to unauthenticated requests and never creates a bucket for them", async () => {
    // Four unknown or missing credentials from the same IP: if the limiter ran
    // before authentication they would share an IP-keyed bucket and the
    // fourth would be 429.
    for (const token of ["nope_1", "nope_2", "nope_3", "nope_4"]) {
      expect((await ticket(token)).status).toBe(401);
    }
    expect((await app.post("/api/v1/stream/ticket").send({ teamId: "t1" })).status).toBe(401);
    // A real user from the same IP still has the whole budget.
    sessions.set("tok_real", "u-real");
    for (let i = 0; i < 3; i += 1) expect((await ticket("tok_real")).status).toBe(201);
    expect((await ticket("tok_real")).status).toBe(429);
  });
});
