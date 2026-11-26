import type { Server } from "node:http";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import supertest from "supertest";

// Route-level tests for the one-time stream ticket: POST /stream/ticket issues
// it, GET /stream/logs?ticket= consumes it, and GET /auth/me reports the
// caller. The redis mock below behaves like the two commands the ticket code
// uses (SET ... EX, atomic GETDEL) with an expiry read from Date.now(), so
// reuse and expiry are exercised through the routes. The real-Redis atomicity
// is in stream-ticket-redis.test.ts. Own app instance, to stay clear of the
// shared app's rate-limit budget.

vi.mock("../../src/ingestion/ingestion-service.js", () => ({
  IngestBatchTooLargeError: class IngestBatchTooLargeError extends Error {},
  IngestionService: class {
    events = { on: vi.fn(), off: vi.fn(), emit: vi.fn() };
    ingest = vi.fn();
  },
}));

const { subscribeCalls, redisEntries } = vi.hoisted(() => ({
  subscribeCalls: [] as Array<{ teamId: string; revalidate?: () => Promise<boolean> }>,
  redisEntries: new Map<string, { value: string; expiresAt: number }>(),
}));

// Records what the route hands to the stream and ends the response, so the
// heartbeat check can be driven directly (the timing is in streaming-service.test.ts).
vi.mock("../../src/services/streaming/streaming-service.js", () => ({
  StreamingService: class {
    subscribe(teamId: string, res: { end: () => void }, _filters: unknown, revalidate?: () => Promise<boolean>) {
      subscribeCalls.push({ teamId, revalidate });
      res.end();
      return () => {};
    }
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
    set: vi.fn(async (key: string, value: string, _mode: string, seconds: number) => {
      redisEntries.set(key, { value, expiresAt: Date.now() + seconds * 1000 });
      return "OK";
    }),
    getdel: vi.fn(async (key: string) => {
      const entry = redisEntries.get(key);
      redisEntries.delete(key);
      return entry && entry.expiresAt > Date.now() ? entry.value : null;
    }),
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
import { redis } from "../../src/repositories/redis.js";

type Mock = ReturnType<typeof vi.fn>;
const db = prisma as unknown as {
  session: { findUnique: Mock };
  user: { findUnique: Mock };
  teamMember: { findUnique: Mock };
};
const redisMock = redis as unknown as { set: Mock; getdel: Mock };

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

type Status = "ACTIVE" | "PENDING" | "DISABLED";

function sessionFor(token: string, userId: string, status: Status = "ACTIVE") {
  return {
    id: `row-${token}`,
    userId,
    token,
    expiresAt: new Date("2099-01-01T00:00:00.000Z"),
    user: { status },
  };
}

// Looks a row up by token (bearer) or by id (a stream opened with a ticket).
function mockSessions(...rows: Array<ReturnType<typeof sessionFor>>) {
  db.session.findUnique.mockImplementation(
    async ({ where }: { where: { token?: string; id?: string } }) =>
      rows.find((row) => (where.token !== undefined ? row.token === where.token : row.id === where.id)) ?? null,
  );
}

// Membership by user and team: { userId: [teamId, ...] }.
function mockMembership(members: Record<string, string[]>, role = "MEMBER") {
  db.teamMember.findUnique.mockImplementation(
    async ({ where }: { where: { teamId_userId: { teamId: string; userId: string } } }) => {
      const { teamId, userId } = where.teamId_userId;
      return (members[userId] ?? []).includes(teamId) ? { id: "tm", teamId, userId, role } : null;
    },
  );
}

const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-06-01T12:00:00.000Z"));
  redisEntries.clear();
  redisMock.set.mockClear();
  redisMock.getdel.mockClear();
  subscribeCalls.length = 0;
  db.session.findUnique.mockReset();
  db.user.findUnique.mockReset();
  db.teamMember.findUnique.mockReset();
  mockSessions(sessionFor("sess_a", "u1"), sessionFor("sess_b", "u2"));
  mockMembership({ u1: ["t1"], u2: ["t2"] });
});

afterEach(() => {
  vi.useRealTimers();
});

async function issue(token = "sess_a", teamId = "t1") {
  const res = await app.post("/api/v1/stream/ticket").set(bearer(token)).send({ teamId });
  expect(res.status).toBe(201);
  return res.body.ticket as string;
}

const openStream = (ticket: string, teamId = "t1") =>
  app.get(`/api/v1/stream/logs?teamId=${teamId}&ticket=${encodeURIComponent(ticket)}`);

describe("POST /api/v1/stream/ticket", () => {
  it("issues a ticket and its lifetime to a team member, never cached", async () => {
    const res = await app.post("/api/v1/stream/ticket").set(bearer("sess_a")).send({ teamId: "t1" });

    expect(res.status).toBe(201);
    expect(res.body.ticket).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(res.body.expiresInSeconds).toBe(60);
    expect(res.headers["cache-control"]).toBe("no-store");
  });

  it("binds the ticket to the caller's session, user and team, expiring in 60 seconds", async () => {
    await issue();

    expect(redisMock.set).toHaveBeenCalledTimes(1);
    const [key, value, mode, seconds] = redisMock.set.mock.calls[0] as [string, string, string, number];
    expect(key).toMatch(/^stream-ticket:[0-9a-f]{64}$/);
    expect(JSON.parse(value)).toEqual({ sessionId: "row-sess_a", userId: "u1", teamId: "t1" });
    expect([mode, seconds]).toEqual(["EX", 60]);
  });

  it("is open to a VIEWER, who may read the stream", async () => {
    mockMembership({ u1: ["t1"] }, "VIEWER");

    const res = await app.post("/api/v1/stream/ticket").set(bearer("sess_a")).send({ teamId: "t1" });

    expect(res.status).toBe(201);
  });

  it("answers 401 without a bearer token and issues nothing", async () => {
    const res = await app.post("/api/v1/stream/ticket").send({ teamId: "t1" });

    expect(res.status).toBe(401);
    expect(redisMock.set).not.toHaveBeenCalled();
  });

  it("answers 401 for an unknown token", async () => {
    const res = await app.post("/api/v1/stream/ticket").set(bearer("sess_unknown")).send({ teamId: "t1" });

    expect(res.status).toBe(401);
    expect(redisMock.set).not.toHaveBeenCalled();
  });

  it("answers 401 when the user is not ACTIVE", async () => {
    mockSessions(sessionFor("sess_a", "u1", "DISABLED"));

    const res = await app.post("/api/v1/stream/ticket").set(bearer("sess_a")).send({ teamId: "t1" });

    expect(res.status).toBe(401);
    expect(redisMock.set).not.toHaveBeenCalled();
  });

  it("answers 400 without a teamId", async () => {
    const res = await app.post("/api/v1/stream/ticket").set(bearer("sess_a")).send({});

    expect(res.status).toBe(400);
    expect(redisMock.set).not.toHaveBeenCalled();
  });

  it("answers 403 for a team the caller is not a member of and issues nothing", async () => {
    const res = await app.post("/api/v1/stream/ticket").set(bearer("sess_a")).send({ teamId: "t2" });

    expect(res.status).toBe(403);
    expect(redisMock.set).not.toHaveBeenCalled();
  });
});

describe("GET /api/v1/stream/logs?ticket=", () => {
  it("opens the stream for the team of the ticket and checks the session by id on each heartbeat", async () => {
    const ticket = await issue();

    await openStream(ticket);

    expect(subscribeCalls).toHaveLength(1);
    expect(subscribeCalls[0].teamId).toBe("t1");
    await expect(subscribeCalls[0].revalidate!()).resolves.toBe(true);
    expect(db.session.findUnique).toHaveBeenLastCalledWith(expect.objectContaining({ where: { id: "row-sess_a" } }));
  });

  it("answers 401 on a second use of the same ticket", async () => {
    const ticket = await issue();
    await openStream(ticket);
    subscribeCalls.length = 0;

    const second = await openStream(ticket);

    expect(second.status).toBe(401);
    expect(second.body).toEqual({ error: "Unauthorized" });
    expect(subscribeCalls).toHaveLength(0);
  });

  it("answers 401 once the ticket is older than 60 seconds", async () => {
    const ticket = await issue();
    vi.setSystemTime(new Date("2026-06-01T12:01:00.000Z"));

    const res = await openStream(ticket);

    expect(res.status).toBe(401);
    expect(subscribeCalls).toHaveLength(0);
  });

  it("still opens at 59 seconds", async () => {
    const ticket = await issue();
    vi.setSystemTime(new Date("2026-06-01T12:00:59.000Z"));

    await openStream(ticket);

    expect(subscribeCalls).toHaveLength(1);
  });

  it("answers 401 for another team than the one the ticket was issued for, and spends the ticket", async () => {
    mockMembership({ u1: ["t1", "t2"] });
    const ticket = await issue("sess_a", "t1");

    const other = await openStream(ticket, "t2");
    const again = await openStream(ticket, "t1");

    expect(other.status).toBe(401);
    expect(other.body).toEqual({ error: "Unauthorized" });
    expect(again.status).toBe(401);
    expect(subscribeCalls).toHaveLength(0);
  });

  it("answers 401 for an unknown ticket", async () => {
    const res = await openStream("A".repeat(43));

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "Unauthorized" });
  });

  it("answers the same 401 body for unknown, used, expired and other-team tickets", async () => {
    mockMembership({ u1: ["t1", "t2"] });
    const used = await issue();
    await openStream(used);
    const expired = await issue();
    vi.setSystemTime(new Date("2026-06-01T12:05:00.000Z"));
    const otherTeam = await issue("sess_a", "t2");

    const bodies = [
      await openStream("A".repeat(43)),
      await openStream(used),
      await openStream(expired),
      await openStream(otherTeam, "t1"),
    ].map((res) => [res.status, res.body]);

    expect(bodies).toEqual(Array(4).fill([401, { error: "Unauthorized" }]));
  });

  it("answers 401 for a ticket whose session was deleted after it was issued", async () => {
    const ticket = await issue();
    mockSessions();

    const res = await openStream(ticket);

    expect(res.status).toBe(401);
    expect(subscribeCalls).toHaveLength(0);
  });

  it("answers 401 for a ticket whose user was disabled after it was issued", async () => {
    const ticket = await issue();
    mockSessions(sessionFor("sess_a", "u1", "DISABLED"));

    const res = await openStream(ticket);

    expect(res.status).toBe(401);
  });

  it("answers 401 for a ticket whose session now belongs to another user", async () => {
    const ticket = await issue();
    mockSessions({ ...sessionFor("sess_a", "u2") });

    const res = await openStream(ticket);

    expect(res.status).toBe(401);
  });

  it("answers 403 when the user left the team between ticket and stream", async () => {
    const ticket = await issue();
    mockMembership({});

    const res = await openStream(ticket);

    expect(res.status).toBe(403);
    expect(subscribeCalls).toHaveLength(0);
  });

  it("answers 401 when the ticket store fails, not a 500 and not an open stream", async () => {
    const ticket = await issue();
    redisMock.getdel.mockRejectedValueOnce(new Error("redis down"));

    const res = await openStream(ticket);

    expect(res.status).toBe(401);
    expect(subscribeCalls).toHaveLength(0);
  });

  it("does not take the session token from a ?token= query", async () => {
    const res = await app.get("/api/v1/stream/logs?teamId=t1&token=sess_a");

    expect(res.status).toBe(401);
    expect(redisMock.getdel).not.toHaveBeenCalled();
    expect(db.session.findUnique).not.toHaveBeenCalled();
    expect(subscribeCalls).toHaveLength(0);
  });

  it("does not take a ticket from the Authorization header", async () => {
    const ticket = await issue();

    const res = await app.get("/api/v1/stream/logs?teamId=t1").set(bearer(ticket));

    expect(res.status).toBe(401);
  });

  it("prefers the header: with both, the bearer opens the stream and the ticket stays unspent", async () => {
    const ticket = await issue();
    redisMock.getdel.mockClear();

    await app
      .get(`/api/v1/stream/logs?teamId=t1&ticket=${ticket}`)
      .set(bearer("sess_a"));

    expect(subscribeCalls).toHaveLength(1);
    expect(redisMock.getdel).not.toHaveBeenCalled();
    await openStream(ticket);
    expect(subscribeCalls).toHaveLength(2);
  });

  it("with both, an invalid header is 401 and does not fall back to the ticket", async () => {
    const ticket = await issue();

    const res = await app
      .get(`/api/v1/stream/logs?teamId=t1&ticket=${ticket}`)
      .set(bearer("sess_unknown"));

    expect(res.status).toBe(401);
    expect(subscribeCalls).toHaveLength(0);
  });

  it("answers 400 for a valid ticket without a teamId", async () => {
    const ticket = await issue();

    const res = await app.get(`/api/v1/stream/logs?ticket=${ticket}`);

    expect(res.status).toBe(400);
  });

  it("only one of several concurrent opens with the same ticket succeeds", async () => {
    const ticket = await issue();

    const results = await Promise.all(Array.from({ length: 6 }, () => openStream(ticket)));

    expect(subscribeCalls).toHaveLength(1);
    expect(results.filter((res) => res.status === 401)).toHaveLength(5);
  });
});

describe("GET /api/v1/auth/me", () => {
  const dbUser = { id: "u1", email: "u1@test.com", name: "U One", role: "ADMIN", status: "ACTIVE" };

  it("returns the caller as the database has them", async () => {
    db.user.findUnique.mockResolvedValue(dbUser);

    const res = await app.get("/api/v1/auth/me").set(bearer("sess_a"));

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ user: dbUser });
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(db.user.findUnique).toHaveBeenCalledWith({
      where: { id: "u1" },
      select: { id: true, email: true, name: true, role: true, status: true },
    });
  });

  it("reports a USER as USER", async () => {
    db.user.findUnique.mockResolvedValue({ ...dbUser, role: "USER" });

    const res = await app.get("/api/v1/auth/me").set(bearer("sess_a"));

    expect(res.body.user.role).toBe("USER");
  });

  it("answers 401 without a token, for an unknown token and for a disabled user", async () => {
    mockSessions(sessionFor("sess_a", "u1", "DISABLED"));

    expect((await app.get("/api/v1/auth/me")).status).toBe(401);
    expect((await app.get("/api/v1/auth/me").set(bearer("sess_unknown"))).status).toBe(401);
    expect((await app.get("/api/v1/auth/me").set(bearer("sess_a"))).status).toBe(401);
  });

  it("answers 401 when the user row is gone", async () => {
    db.user.findUnique.mockResolvedValue(null);

    const res = await app.get("/api/v1/auth/me").set(bearer("sess_a"));

    expect(res.status).toBe(401);
  });
});
