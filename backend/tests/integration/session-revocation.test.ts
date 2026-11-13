import type { Server } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import supertest from "supertest";

// Route-level tests for revoking access: a session stops working when its user
// is not ACTIVE, an admin disabling a user deletes that user's sessions,
// POST /auth/logout ends the presented session only, and removing a member
// from a team removes that member's subscriptions in the same transaction. Own
// app instance, like ingest-incident-subscription-routes.test.ts, to stay
// clear of the shared app's rate-limit budget.

vi.mock("../../src/ingestion/ingestion-service.js", () => ({
  IngestBatchTooLargeError: class IngestBatchTooLargeError extends Error {},
  IngestionService: class {
    events = { on: vi.fn(), off: vi.fn(), emit: vi.fn() };
    ingest = vi.fn();
  },
}));

const { subscribeCalls } = vi.hoisted(() => ({
  subscribeCalls: [] as Array<{ teamId: string; revalidate?: () => Promise<boolean> }>,
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
    set: vi.fn(),
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
  $transaction: Mock;
  session: { findUnique: Mock; create: Mock; deleteMany: Mock };
  user: { findUnique: Mock; update: Mock };
  teamMember: { findMany: Mock; findUnique: Mock; delete: Mock };
  alertSubscription: { deleteMany: Mock };
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

type Status = "ACTIVE" | "PENDING" | "DISABLED";

// Session rows by token; the user status is the one the session lookup returns.
function sessionFor(token: string, userId: string, status: Status) {
  return {
    id: `row-${token}`,
    userId,
    token,
    expiresAt: new Date("2099-01-01T00:00:00.000Z"),
    user: { status },
  };
}

function mockSessions(...rows: Array<ReturnType<typeof sessionFor>>) {
  db.session.findUnique.mockImplementation(
    async ({ where }: { where: { token: string } }) => rows.find((row) => row.token === where.token) ?? null,
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  db.$transaction.mockImplementation(async (ops: Array<Promise<unknown>>) => Promise.all(ops));
  db.teamMember.findMany.mockResolvedValue([]);
  db.session.deleteMany.mockResolvedValue({ count: 1 });
});

const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

describe("a session whose user is not ACTIVE", () => {
  it("is accepted for an ACTIVE user (control)", async () => {
    mockSessions(sessionFor("sess_a", "u1", "ACTIVE"));

    const res = await app.get("/api/v1/teams").set(bearer("sess_a"));

    expect(res.status).toBe(200);
  });

  it("is rejected with 401 on a bearer route once the user is DISABLED", async () => {
    mockSessions(sessionFor("sess_a", "u1", "DISABLED"));

    const res = await app.get("/api/v1/teams").set(bearer("sess_a"));

    expect(res.status).toBe(401);
    expect(db.teamMember.findMany).not.toHaveBeenCalled();
  });

  it("is rejected with 401 when the user is PENDING", async () => {
    mockSessions(sessionFor("sess_a", "u1", "PENDING"));

    const res = await app.get("/api/v1/teams").set(bearer("sess_a"));

    expect(res.status).toBe(401);
  });

  it("is rejected with 401 on the log stream, by header and by ?token=", async () => {
    mockSessions(sessionFor("sess_a", "u1", "DISABLED"));

    const byHeader = await app.get("/api/v1/stream/logs?teamId=t1").set(bearer("sess_a"));
    const byQuery = await app.get("/api/v1/stream/logs?teamId=t1&token=sess_a");

    expect(byHeader.status).toBe(401);
    expect(byQuery.status).toBe(401);
  });

  it("is rejected with 401 on the admin routes even for a DISABLED admin", async () => {
    mockSessions(sessionFor("sess_admin", "admin-1", "DISABLED"));
    db.user.findUnique.mockResolvedValue({ id: "admin-1", role: "ADMIN" });

    const res = await app.get("/api/v1/admin/stats").set(bearer("sess_admin"));

    expect(res.status).toBe(401);
  });

  it("works again after the user is re-enabled and logs in afresh", async () => {
    db.user.findUnique.mockResolvedValue({
      id: "u1",
      email: "u1@test.com",
      passwordHash: "hash",
      name: "U One",
      role: "USER",
      status: "ACTIVE",
      createdAt: new Date("2026-03-23T00:00:00.000Z"),
    });
    db.session.create.mockResolvedValue({ id: "new-row" });

    const login = await app
      .post("/api/v1/auth/login")
      .send({ email: "u1@test.com", password: "pw-long-enough" });

    expect(login.status).toBe(200);
    const token = login.body.token as string;
    expect(token).toMatch(/^sess_/);
    mockSessions(sessionFor(token, "u1", "ACTIVE"));
    const res = await app.get("/api/v1/teams").set(bearer(token));
    expect(res.status).toBe(200);
  });

  it("cannot log in while DISABLED", async () => {
    db.user.findUnique.mockResolvedValue({ id: "u1", email: "u1@test.com", status: "DISABLED" });

    const login = await app
      .post("/api/v1/auth/login")
      .send({ email: "u1@test.com", password: "pw-long-enough" });

    expect(login.status).toBe(401);
    expect(db.session.create).not.toHaveBeenCalled();
  });
});

describe("GET /api/v1/stream/logs re-validation", () => {
  beforeEach(() => {
    subscribeCalls.length = 0;
    db.teamMember.findUnique.mockResolvedValue({ id: "tm", teamId: "t1", userId: "u1", role: "MEMBER" });
  });

  async function openStream(by: "header" | "query") {
    mockSessions(sessionFor("sess_a", "u1", "ACTIVE"));
    const req =
      by === "header"
        ? app.get("/api/v1/stream/logs?teamId=t1").set(bearer("sess_a"))
        : app.get("/api/v1/stream/logs?teamId=t1&token=sess_a");
    await req;
    expect(subscribeCalls).toHaveLength(1);
    expect(subscribeCalls[0].teamId).toBe("t1");
    return subscribeCalls[0].revalidate!;
  }

  it("hands the stream a check that passes while session and membership hold", async () => {
    const revalidate = await openStream("header");

    await expect(revalidate()).resolves.toBe(true);
  });

  it("uses the ?token= token too", async () => {
    const revalidate = await openStream("query");

    await expect(revalidate()).resolves.toBe(true);
  });

  it("fails the check once the user is disabled after the stream opened", async () => {
    const revalidate = await openStream("header");
    mockSessions(sessionFor("sess_a", "u1", "DISABLED"));

    await expect(revalidate()).resolves.toBe(false);
  });

  it("fails the check once the session is deleted after the stream opened", async () => {
    const revalidate = await openStream("header");
    mockSessions();

    await expect(revalidate()).resolves.toBe(false);
  });

  it("fails the check once the user is removed from the team after the stream opened", async () => {
    const revalidate = await openStream("header");
    db.teamMember.findUnique.mockResolvedValue(null);

    await expect(revalidate()).resolves.toBe(false);
  });
});

describe("PUT /api/v1/admin/users/:id", () => {
  const updated = (status: Status) => ({
    id: "target",
    email: "t@test.com",
    name: "T",
    role: "USER",
    status,
    createdAt: new Date("2026-03-23T00:00:00.000Z"),
  });

  beforeEach(() => {
    mockSessions(sessionFor("sess_admin", "admin-1", "ACTIVE"));
    db.user.findUnique.mockResolvedValue({ id: "admin-1", role: "ADMIN" });
  });

  it("deletes every session of the user it disables", async () => {
    db.user.update.mockResolvedValue(updated("DISABLED"));

    const res = await app
      .put("/api/v1/admin/users/target")
      .set(bearer("sess_admin"))
      .send({ disabled: true });

    expect(res.status).toBe(200);
    expect(db.session.deleteMany).toHaveBeenCalledExactlyOnceWith({ where: { userId: "target" } });
  });

  it("deletes the sessions when the status is set to DISABLED directly", async () => {
    db.user.update.mockResolvedValue(updated("DISABLED"));

    const res = await app
      .put("/api/v1/admin/users/target")
      .set(bearer("sess_admin"))
      .send({ status: "DISABLED" });

    expect(res.status).toBe(200);
    expect(db.session.deleteMany).toHaveBeenCalledExactlyOnceWith({ where: { userId: "target" } });
  });

  it("keeps the sessions when it re-enables the user", async () => {
    db.user.update.mockResolvedValue(updated("ACTIVE"));

    const res = await app
      .put("/api/v1/admin/users/target")
      .set(bearer("sess_admin"))
      .send({ disabled: false });

    expect(res.status).toBe(200);
    expect(db.session.deleteMany).not.toHaveBeenCalled();
  });

  it("keeps the sessions of an ACTIVE user whose role changes", async () => {
    db.user.update.mockResolvedValue(updated("ACTIVE"));

    const res = await app.put("/api/v1/admin/users/target").set(bearer("sess_admin")).send({ role: "ADMIN" });

    expect(res.status).toBe(200);
    expect(db.session.deleteMany).not.toHaveBeenCalled();
  });

  it("deletes no session when the user does not exist", async () => {
    db.user.update.mockRejectedValue(Object.assign(new Error("not found"), { code: "P2025" }));

    await app.put("/api/v1/admin/users/ghost").set(bearer("sess_admin")).send({ disabled: true });

    expect(db.session.deleteMany).not.toHaveBeenCalled();
  });
});

describe("POST /api/v1/auth/logout", () => {
  it("deletes the presented session by its token and answers 204", async () => {
    mockSessions(sessionFor("sess_phone", "u1", "ACTIVE"), sessionFor("sess_laptop", "u1", "ACTIVE"));

    const res = await app.post("/api/v1/auth/logout").set(bearer("sess_phone"));

    expect(res.status).toBe(204);
    expect(db.session.deleteMany).toHaveBeenCalledExactlyOnceWith({ where: { token: "sess_phone" } });
  });

  it("leaves the user's other sessions alone: the delete is keyed on the token, not on the user", async () => {
    mockSessions(sessionFor("sess_phone", "u1", "ACTIVE"), sessionFor("sess_laptop", "u1", "ACTIVE"));

    await app.post("/api/v1/auth/logout").set(bearer("sess_phone"));

    const where = db.session.deleteMany.mock.calls[0][0].where;
    expect(where).not.toHaveProperty("userId");
    expect(where.token).not.toBe("sess_laptop");
  });

  it("answers 401 without a token and deletes nothing", async () => {
    const res = await app.post("/api/v1/auth/logout");

    expect(res.status).toBe(401);
    expect(db.session.deleteMany).not.toHaveBeenCalled();
  });

  it("answers 401 for an unknown token and deletes nothing", async () => {
    mockSessions();

    const res = await app.post("/api/v1/auth/logout").set(bearer("sess_unknown"));

    expect(res.status).toBe(401);
    expect(db.session.deleteMany).not.toHaveBeenCalled();
  });
});

describe("removing a member from a team", () => {
  beforeEach(() => {
    mockSessions(sessionFor("sess_admin", "admin-1", "ACTIVE"));
    db.user.findUnique.mockResolvedValue({ id: "admin-1", role: "ADMIN" });
    db.alertSubscription.deleteMany.mockResolvedValue({ count: 2 });
    db.teamMember.delete.mockResolvedValue({ id: "tm-1" });
  });

  it("DELETE /admin/users/:id/remove-from-team/:teamId deletes the member's subscriptions of that team with the membership", async () => {
    const res = await app.delete("/api/v1/admin/users/u9/remove-from-team/t1").set(bearer("sess_admin"));

    expect(res.status).toBe(204);
    expect(db.alertSubscription.deleteMany).toHaveBeenCalledExactlyOnceWith({
      where: { teamId: "t1", userId: "u9" },
    });
    expect(db.teamMember.delete).toHaveBeenCalledExactlyOnceWith({
      where: { teamId_userId: { teamId: "t1", userId: "u9" } },
    });
    expect(db.$transaction).toHaveBeenCalledOnce();
  });

  it("DELETE /admin/teams/:id/members/:userId deletes the member's subscriptions of that team with the membership", async () => {
    const res = await app.delete("/api/v1/admin/teams/t1/members/u9").set(bearer("sess_admin"));

    expect(res.status).toBe(204);
    expect(db.alertSubscription.deleteMany).toHaveBeenCalledExactlyOnceWith({
      where: { teamId: "t1", userId: "u9" },
    });
    expect(db.teamMember.delete).toHaveBeenCalledExactlyOnceWith({
      where: { teamId_userId: { teamId: "t1", userId: "u9" } },
    });
    expect(db.$transaction).toHaveBeenCalledOnce();
  });

  it("DELETE /admin/teams/:id/members/:userId still answers 404 for a user who is not a member", async () => {
    db.teamMember.delete.mockRejectedValue(
      Object.assign(new Error("Record to delete does not exist"), {
        code: "P2025",
        name: "PrismaClientKnownRequestError",
      }),
    );

    const res = await app.delete("/api/v1/admin/teams/t1/members/ghost").set(bearer("sess_admin"));

    expect(res.status).toBe(404);
  });
});
