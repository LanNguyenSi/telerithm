import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import supertest from "supertest";

// Mock external dependencies before importing app
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
  },
}));

vi.mock("../../src/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), fatal: vi.fn() },
  createChildLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

vi.mock("../../src/repositories/prisma.js", () => {
  const mockPrisma = {
    $queryRaw: vi.fn().mockResolvedValue([{ "?column?": 1 }]),
    $connect: vi.fn(),
    $disconnect: vi.fn(),
    user: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
    },
    session: {
      findUnique: vi.fn(),
      create: vi.fn(),
    },
    team: {
      create: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
    },
    teamMember: {
      findMany: vi.fn().mockResolvedValue([]),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      upsert: vi.fn(),
      delete: vi.fn(),
    },
    logSource: {
      findUnique: vi.fn(),
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn(),
      count: vi.fn().mockResolvedValue(0),
    },
    logView: {
      findMany: vi.fn().mockResolvedValue([]),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      delete: vi.fn(),
    },
    alertRule: {
      findMany: vi.fn().mockResolvedValue([]),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    alertIncident: {
      findMany: vi.fn().mockResolvedValue([]),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    incidentEvent: {
      create: vi.fn(),
      findMany: vi.fn().mockResolvedValue([]),
    },
    $transaction: vi.fn(),
    maintenanceWindow: {
      findMany: vi.fn(),
      create: vi.fn(),
      delete: vi.fn(),
    },
    issue: {
      findMany: vi.fn().mockResolvedValue([]),
      findUnique: vi.fn(),
      update: vi.fn(),
      count: vi.fn().mockResolvedValue(0),
      upsert: vi.fn(),
    },
    teamInvite: {
      create: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn().mockResolvedValue([]),
      update: vi.fn(),
      deleteMany: vi.fn(),
    },
  };
  return {
    prisma: mockPrisma,
    connectDatabase: vi.fn(),
    disconnectDatabase: vi.fn(),
  };
});

vi.mock("../../src/repositories/clickhouse.js", () => ({
  clickhouse: {
    ping: vi.fn().mockResolvedValue({ success: true }),
    query: vi.fn(),
    insert: vi.fn(),
    close: vi.fn(),
  },
  connectClickHouse: vi.fn(),
  disconnectClickHouse: vi.fn(),
}));

vi.mock("../../src/repositories/redis.js", () => ({
  redis: {
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn(),
    keys: vi.fn().mockResolvedValue([]),
    del: vi.fn(),
    ping: vi.fn().mockResolvedValue("PONG"),
    connect: vi.fn(),
    quit: vi.fn(),
    on: vi.fn(),
  },
  connectRedis: vi.fn(),
  disconnectRedis: vi.fn(),
}));

import { config } from "../../src/config/index.js";
import { clickhouse } from "../../src/repositories/clickhouse.js";
import { prisma } from "../../src/repositories/prisma.js";
import { redis } from "../../src/repositories/redis.js";

let app: supertest.Agent;

const mockedConfig = config;
const mockedPrisma = prisma as typeof prisma & {
  $queryRaw: ReturnType<typeof vi.fn>;
  user: {
    findUnique: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    findMany: ReturnType<typeof vi.fn>;
    count: ReturnType<typeof vi.fn>;
  };
  session: {
    findUnique: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
  };
  team: {
    create: ReturnType<typeof vi.fn>;
    findUnique: ReturnType<typeof vi.fn>;
    findMany: ReturnType<typeof vi.fn>;
    count: ReturnType<typeof vi.fn>;
  };
  teamMember: {
    findMany: ReturnType<typeof vi.fn>;
    findUnique: ReturnType<typeof vi.fn>;
    findFirst: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    upsert: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
  };
  logSource: {
    findUnique: ReturnType<typeof vi.fn>;
    findMany: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    count: ReturnType<typeof vi.fn>;
  };
  logView: {
    findMany: ReturnType<typeof vi.fn>;
    findUnique: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    updateMany: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
  };
  alertRule: {
    findMany: ReturnType<typeof vi.fn>;
    findUnique: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  alertIncident: {
    findMany: ReturnType<typeof vi.fn>;
    findUnique: ReturnType<typeof vi.fn>;
    findFirst: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  incidentEvent: {
    create: ReturnType<typeof vi.fn>;
    findMany: ReturnType<typeof vi.fn>;
  };
  $transaction: ReturnType<typeof vi.fn>;
  maintenanceWindow: {
    findMany: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
  };
  issue: {
    findMany: ReturnType<typeof vi.fn>;
    findUnique: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    count: ReturnType<typeof vi.fn>;
    upsert: ReturnType<typeof vi.fn>;
  };
  teamInvite: {
    create: ReturnType<typeof vi.fn>;
    findUnique: ReturnType<typeof vi.fn>;
    findMany: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    deleteMany: ReturnType<typeof vi.fn>;
  };
};
const mockedClickhouse = clickhouse as typeof clickhouse & {
  query: ReturnType<typeof vi.fn>;
  ping: ReturnType<typeof vi.fn>;
};
const mockedRedis = redis as typeof redis & {
  get: ReturnType<typeof vi.fn>;
  keys: ReturnType<typeof vi.fn>;
  ping: ReturnType<typeof vi.fn>;
};

function makeUser(overrides: Record<string, unknown> = {}) {
  return {
    id: "user-1",
    email: "user@test.com",
    passwordHash: "hashed-password",
    name: "Test User",
    role: "USER",
    status: "ACTIVE",
    createdAt: new Date("2026-03-23T00:00:00.000Z"),
    ...overrides,
  };
}

function makeSession(overrides: Record<string, unknown> = {}) {
  return {
    id: "session-1",
    userId: "admin-1",
    token: "sess_admin",
    expiresAt: new Date("2099-01-01T00:00:00.000Z"),
    ...overrides,
  };
}

function makeClickhouseResult<T>(rows: T[]) {
  return {
    json: vi.fn().mockResolvedValue(rows),
  };
}

beforeAll(async () => {
  const { createApp } = await import("../../src/app.js");
  app = supertest(createApp());
});

beforeEach(() => {
  // resetAllMocks (not clearAllMocks) so mockResolvedValueOnce queues are drained
  // between tests, not just call history. clearAllMocks leaves once-queues intact,
  // which would let an unconsumed mockResolvedValueOnce leak into the next test.
  // Because reset also drops implementations, every default the suite relies on is
  // re-seeded below: this block is the authoritative source for mock defaults (the
  // vi.mock factories above only establish the shape for module-load safety).
  vi.resetAllMocks();

  mockedConfig.multiTenant = false;
  mockedConfig.registrationMode = "approval";
  mockedConfig.adminEmail = "admin@test.com";
  mockedConfig.maxPageSize = 500;
  mockedConfig.maxLookbackMs = 7 * 24 * 60 * 60 * 1000;
  mockedConfig.maxSyncRuntimeMs = 1500;

  mockedClickhouse.ping.mockResolvedValue({ success: true });

  mockedRedis.get.mockResolvedValue(null);
  mockedRedis.keys.mockResolvedValue([]);
  mockedRedis.ping.mockResolvedValue("PONG");

  mockedPrisma.$queryRaw.mockResolvedValue([{ "?column?": 1 }]);
  mockedPrisma.user.findUnique.mockResolvedValue(null);
  mockedPrisma.user.create.mockResolvedValue(makeUser());
  mockedPrisma.user.update.mockResolvedValue(makeUser());
  mockedPrisma.user.findMany.mockResolvedValue([]);
  mockedPrisma.user.count.mockResolvedValue(0);
  mockedPrisma.session.findUnique.mockResolvedValue(null);
  mockedPrisma.session.create.mockResolvedValue({ id: "session-1" });
  mockedPrisma.team.findUnique.mockResolvedValue({
    id: "team-default",
    name: "Default",
    slug: "default",
    createdAt: new Date("2026-03-23T00:00:00.000Z"),
  });
  mockedPrisma.team.create.mockResolvedValue({
    id: "team-default",
    name: "Default",
    slug: "default",
    createdAt: new Date("2026-03-23T00:00:00.000Z"),
  });
  mockedPrisma.team.findMany.mockResolvedValue([]);
  mockedPrisma.team.count.mockResolvedValue(0);
  mockedPrisma.teamMember.findUnique.mockResolvedValue(null);
  mockedPrisma.teamMember.findFirst.mockResolvedValue(null);
  mockedPrisma.teamMember.findMany.mockResolvedValue([]);
  mockedPrisma.teamMember.upsert.mockResolvedValue({
    id: "member-1",
    teamId: "team-default",
    userId: "user-1",
    role: "MEMBER",
    joinedAt: new Date("2026-03-23T00:00:00.000Z"),
  });
  mockedPrisma.teamMember.create.mockResolvedValue({
    id: "member-1",
    teamId: "team-1",
    userId: "user-2",
    role: "MEMBER",
    joinedAt: new Date("2026-03-23T00:00:00.000Z"),
  });
  mockedPrisma.logSource.findMany.mockResolvedValue([]);
  mockedPrisma.logSource.count.mockResolvedValue(0);
  mockedPrisma.logView.findMany.mockResolvedValue([]);
  mockedPrisma.teamInvite.findMany.mockResolvedValue([]);
  mockedPrisma.teamInvite.findUnique.mockResolvedValue(null);
  mockedPrisma.alertIncident.findUnique.mockResolvedValue(null);
  mockedPrisma.alertIncident.findFirst.mockResolvedValue(null);
  mockedPrisma.incidentEvent.findMany.mockResolvedValue([]);
  mockedPrisma.$transaction.mockImplementation(async (ops: Array<Promise<unknown>>) =>
    Promise.all(ops),
  );
  mockedPrisma.logView.updateMany.mockResolvedValue({ count: 0 });
  mockedPrisma.alertRule.findMany.mockResolvedValue([]);
  mockedPrisma.alertRule.findUnique.mockResolvedValue(null);
  mockedPrisma.alertIncident.findMany.mockResolvedValue([]);
  mockedPrisma.issue.findMany.mockResolvedValue([]);
  mockedPrisma.issue.count.mockResolvedValue(0);
});

describe("API Routes", () => {
  describe("GET /api/v1/health", () => {
    it("returns health status", async () => {
      const res = await app.get("/api/v1/health");
      expect(res.status).toBe(200);
      expect(res.body.status).toBe("ok");
      expect(res.body.checks).toHaveProperty("postgres");
      expect(res.body.checks).toHaveProperty("clickhouse");
      expect(res.body.checks).toHaveProperty("redis");
    });
  });

  describe("POST /api/v1/auth/register", () => {
    it("rejects invalid email", async () => {
      const res = await app
        .post("/api/v1/auth/register")
        .send({ email: "bad", password: "123456", name: "Test" });
      expect(res.status).toBe(400);
    });

    it("rejects short password", async () => {
      const res = await app
        .post("/api/v1/auth/register")
        .send({ email: "test@test.com", password: "123", name: "Test" });
      expect(res.status).toBe(400);
    });

    it("rejects missing fields", async () => {
      const res = await app.post("/api/v1/auth/register").send({});
      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty("error");
    });

    it("creates an active user and assigns the default team in open mode", async () => {
      mockedConfig.registrationMode = "open";
      mockedConfig.adminEmail = undefined;
      mockedPrisma.user.create.mockResolvedValueOnce(makeUser());

      const res = await app
        .post("/api/v1/auth/register")
        .send({ email: "user@test.com", password: "123456", name: "Test User" });

      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty("token");
      expect(res.body.user.status).toBe("ACTIVE");
      expect(mockedPrisma.user.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            email: "user@test.com",
            role: "USER",
            status: "ACTIVE",
          }),
        }),
      );
      expect(mockedPrisma.teamMember.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({ role: "MEMBER" }),
          update: expect.objectContaining({ role: "MEMBER" }),
        }),
      );
    });

    it("returns pending approval without team assignment in approval mode", async () => {
      mockedConfig.registrationMode = "approval";
      mockedConfig.adminEmail = undefined;
      mockedPrisma.user.create.mockResolvedValueOnce(makeUser({ status: "PENDING" }));

      const res = await app
        .post("/api/v1/auth/register")
        .send({ email: "pending@test.com", password: "123456", name: "Pending User" });

      expect(res.status).toBe(201);
      expect(res.body.status).toBe("pending_approval");
      expect(res.body.user.status).toBe("PENDING");
      expect(mockedPrisma.session.create).not.toHaveBeenCalled();
      expect(mockedPrisma.teamMember.upsert).not.toHaveBeenCalled();
    });

    it("rejects registration in invite-only mode", async () => {
      mockedConfig.registrationMode = "invite-only";
      mockedConfig.adminEmail = undefined;

      const res = await app
        .post("/api/v1/auth/register")
        .send({ email: "blocked@test.com", password: "123456", name: "Blocked User" });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("Registration is currently invite-only");
      expect(mockedPrisma.user.create).not.toHaveBeenCalled();
    });

    it("creates the bootstrap admin as active regardless of registration mode", async () => {
      mockedConfig.registrationMode = "invite-only";
      mockedConfig.adminEmail = "admin@test.com";
      mockedPrisma.user.create.mockResolvedValueOnce(
        makeUser({ id: "admin-1", email: "admin@test.com", role: "ADMIN", status: "ACTIVE" }),
      );

      const res = await app
        .post("/api/v1/auth/register")
        .send({ email: "admin@test.com", password: "123456", name: "Admin User" });

      expect(res.status).toBe(201);
      expect(res.body.user.role).toBe("ADMIN");
      expect(res.body.user.status).toBe("ACTIVE");
      expect(mockedPrisma.user.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            email: "admin@test.com",
            role: "ADMIN",
            status: "ACTIVE",
          }),
        }),
      );
      expect(mockedPrisma.teamMember.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({ role: "OWNER" }),
          update: expect.objectContaining({ role: "OWNER" }),
        }),
      );
    });
  });

  describe("POST /api/v1/auth/login", () => {
    it("rejects invalid body", async () => {
      const res = await app.post("/api/v1/auth/login").send({});
      expect(res.status).toBe(400);
    });
  });

  describe("GET /api/v1/teams", () => {
    it("rejects missing auth header", async () => {
      const res = await app.get("/api/v1/teams");
      expect(res.status).toBe(401);
    });
  });

  describe("mock isolation (regression: mockResolvedValueOnce queue leak)", () => {
    // Guards the beforeEach resetAllMocks choice: a mockResolvedValueOnce queued
    // in one test but never consumed must not survive into the next test. Under the
    // old vi.clearAllMocks() the second test below would observe the "leaked-user"
    // session instead of the default null.
    it("queues an unconsumed session.findUnique once-value", () => {
      mockedPrisma.session.findUnique.mockResolvedValueOnce(makeSession({ userId: "leaked-user" }));
      // intentionally left unconsumed
    });

    it("does not inherit the previous test's unconsumed once-value", async () => {
      const session = await mockedPrisma.session.findUnique({ where: { token: "anything" } });
      expect(session).toBeNull();
    });
  });

  describe("Prisma error mapping", () => {
    it("maps P2025 on an update to 404 (POST /alerts/rules/:id/mute)", async () => {
      // The rule resolves and the caller is a member (so the authz gate passes),
      // but the row vanishes before the update — the P2025 mapping is what turns
      // that race into a 404.
      mockedPrisma.session.findUnique.mockResolvedValueOnce(makeSession({ userId: "user-1" }));
      mockedPrisma.alertRule.findUnique.mockResolvedValueOnce({ teamId: "t1" });
      mockedPrisma.teamMember.findUnique.mockResolvedValueOnce({
        id: "member-1",
        teamId: "t1",
        userId: "user-1",
        role: "MEMBER",
        joinedAt: new Date("2026-03-23T00:00:00.000Z"),
      });
      const notFound = Object.assign(new Error("Record to update not found."), { code: "P2025" });
      mockedPrisma.alertRule.update.mockRejectedValueOnce(notFound);

      const res = await app
        .post("/api/v1/alerts/rules/missing-rule/mute")
        .set("Authorization", "Bearer sess_admin")
        .send({ durationMinutes: 30 });

      expect(res.status).toBe(404);
      expect(res.body.error).toBe("Alert rule not found");
    });

    it("maps P2002 on a create to 409 (POST /maintenance-windows)", async () => {
      mockedPrisma.session.findUnique.mockResolvedValueOnce(makeSession({ userId: "user-1" }));
      mockedPrisma.teamMember.findUnique.mockResolvedValueOnce({
        id: "member-1",
        teamId: "t1",
        userId: "user-1",
        role: "ADMIN",
        joinedAt: new Date("2026-03-23T00:00:00.000Z"),
      });
      const conflict = Object.assign(new Error("Unique constraint failed."), { code: "P2002" });
      mockedPrisma.maintenanceWindow.create.mockRejectedValueOnce(conflict);

      const res = await app
        .post("/api/v1/maintenance-windows")
        .set("Authorization", "Bearer sess_admin")
        .send({
          teamId: "t1",
          name: "Deploy freeze",
          startsAt: "2026-07-01T00:00:00.000Z",
          endsAt: "2026-07-01T01:00:00.000Z",
        });

      expect(res.status).toBe(409);
      expect(res.body.error).toBe("Maintenance window already exists");
    });
  });

  describe("GET /api/v1/sources", () => {
    it("rejects missing teamId", async () => {
      mockedPrisma.session.findUnique.mockResolvedValueOnce(makeSession({ userId: "user-1" }));
      const res = await app.get("/api/v1/sources").set("Authorization", "Bearer sess_admin");
      expect(res.status).toBe(400);
      expect(res.body.error).toBe("teamId is required");
    });

    it("returns sources for teamId", async () => {
      mockedPrisma.session.findUnique.mockResolvedValueOnce(makeSession({ userId: "user-1" }));
      mockedPrisma.teamMember.findUnique.mockResolvedValueOnce({
        id: "member-1",
        teamId: "t1",
        userId: "user-1",
        role: "MEMBER",
        joinedAt: new Date("2026-03-23T00:00:00.000Z"),
      });
      const res = await app.get("/api/v1/sources?teamId=t1").set("Authorization", "Bearer sess_admin");
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("sources");
    });

    it("rejects GET /api/v1/sources when the authed user is not a team member (cross-team)", async () => {
      mockedPrisma.session.findUnique.mockResolvedValueOnce(makeSession({ userId: "user-1" }));
      mockedPrisma.teamMember.findUnique.mockResolvedValueOnce(null);
      const res = await app
        .get("/api/v1/sources?teamId=other-team")
        .set("Authorization", "Bearer sess_admin");
      expect(res.status).toBe(403);
      expect(mockedPrisma.teamMember.findUnique).toHaveBeenCalledWith({
        where: { teamId_userId: { teamId: "other-team", userId: "user-1" } },
      });
    });
  });

  describe("POST /api/v1/subscriptions", () => {
    it("rejects creating a subscription for a team the user does not belong to (cross-team)", async () => {
      mockedPrisma.session.findUnique.mockResolvedValueOnce(makeSession({ userId: "user-1" }));
      mockedPrisma.teamMember.findUnique.mockResolvedValueOnce(null);
      const res = await app
        .post("/api/v1/subscriptions")
        .set("Authorization", "Bearer sess_admin")
        .send({ teamId: "other-team", channel: "EMAIL", config: {} });
      expect(res.status).toBe(403);
      expect(mockedPrisma.teamMember.findUnique).toHaveBeenCalledWith({
        where: { teamId_userId: { teamId: "other-team", userId: "user-1" } },
      });
    });
  });

  describe("POST /api/v1/ingest/:sourceId", () => {
    it("rejects missing API key", async () => {
      const res = await app.post("/api/v1/ingest/source-1").send({ logs: ["test log"] });
      expect(res.status).toBe(401);
      expect(res.body.error).toBe("Missing X-API-Key header");
    });

    it("rejects invalid API key", async () => {
      const res = await app
        .post("/api/v1/ingest/source-1")
        .set("X-API-Key", "invalid-key")
        .send({ logs: ["test log"] });
      expect(res.status).toBe(403);
    });

    it("rejects invalid body without API key validation", async () => {
      const res = await app.post("/api/v1/ingest/source-1").send({});
      // Missing X-API-Key header → 401 before body validation
      expect(res.status).toBe(401);
    });
  });

  describe("POST /api/v1/logs/search", () => {
    it("rejects missing teamId", async () => {
      mockedPrisma.session.findUnique.mockResolvedValueOnce(makeSession({ userId: "user-1" }));
      const res = await app.post("/api/v1/logs/search").set("Authorization", "Bearer sess_admin").send({});
      expect(res.status).toBe(400);
    });

    it("supports offset pagination and returns total count", async () => {
      mockedPrisma.session.findUnique.mockResolvedValueOnce(makeSession({ userId: "user-1" }));
      mockedPrisma.teamMember.findUnique.mockResolvedValueOnce({
        id: "member-1",
        teamId: "t1",
        userId: "user-1",
        role: "MEMBER",
        joinedAt: new Date("2026-03-23T00:00:00.000Z"),
      });
      mockedClickhouse.query
        .mockResolvedValueOnce(makeClickhouseResult([{ total: "12" }]))
        .mockResolvedValueOnce(
          makeClickhouseResult([
            {
              team_id: "t1",
              source_id: "s1",
              timestamp: "2026-03-23 10:00:00.000",
              level: "info",
              service: "svc-1",
              host: "host-1",
              message: "first page",
              fields: {},
            },
          ]),
        );

      const res = await app
        .post("/api/v1/logs/search")
        .set("Authorization", "Bearer sess_admin")
        .send({ teamId: "t1", limit: 5, offset: 0 });

      expect(res.status).toBe(200);
      expect(res.body.total).toBe(12);
      expect(res.body.requestId).toBeTruthy();
      expect(res.body.partial).toBe(false);
      expect(res.body.logs).toHaveLength(1);
      expect(mockedClickhouse.query).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          query_params: expect.objectContaining({ limit: 5, offset: 0 }),
        }),
      );
    });

    it("rejects search limit above configured max page size", async () => {
      mockedPrisma.session.findUnique.mockResolvedValueOnce(makeSession({ userId: "user-1" }));
      mockedPrisma.teamMember.findUnique.mockResolvedValueOnce({
        id: "member-1",
        teamId: "t1",
        userId: "user-1",
        role: "MEMBER",
        joinedAt: new Date("2026-03-23T00:00:00.000Z"),
      });
      mockedConfig.maxPageSize = 50;
      const res = await app
        .post("/api/v1/logs/search")
        .set("Authorization", "Bearer sess_admin")
        .send({ teamId: "t1", limit: 100 });
      expect(res.status).toBe(400);
      expect(res.body.error).toContain("limit exceeds maximum");
    });

    it("accepts opaque page token and maps it to offset", async () => {
      mockedPrisma.session.findUnique.mockResolvedValueOnce(makeSession({ userId: "user-1" }));
      mockedPrisma.teamMember.findUnique.mockResolvedValueOnce({
        id: "member-1",
        teamId: "t1",
        userId: "user-1",
        role: "MEMBER",
        joinedAt: new Date("2026-03-23T00:00:00.000Z"),
      });
      mockedClickhouse.query
        .mockResolvedValueOnce(makeClickhouseResult([{ total: "20" }]))
        .mockResolvedValueOnce(makeClickhouseResult([]));

      const pageToken = Buffer.from(JSON.stringify({ offset: 10 }), "utf8").toString("base64url");
      const res = await app
        .post("/api/v1/logs/search")
        .set("Authorization", "Bearer sess_admin")
        .send({ teamId: "t1", limit: 5, pageToken });

      expect(res.status).toBe(200);
      expect(mockedClickhouse.query).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          query_params: expect.objectContaining({ limit: 5, offset: 10 }),
        }),
      );
    });

    it("returns the next page when offset advances", async () => {
      mockedPrisma.session.findUnique.mockResolvedValueOnce(makeSession({ userId: "user-1" }));
      mockedPrisma.teamMember.findUnique.mockResolvedValueOnce({
        id: "member-1",
        teamId: "t1",
        userId: "user-1",
        role: "MEMBER",
        joinedAt: new Date("2026-03-23T00:00:00.000Z"),
      });
      mockedClickhouse.query
        .mockResolvedValueOnce(makeClickhouseResult([{ total: "12" }]))
        .mockResolvedValueOnce(
          makeClickhouseResult([
            {
              team_id: "t1",
              source_id: "s1",
              timestamp: "2026-03-23 10:05:00.000",
              level: "warn",
              service: "svc-2",
              host: "host-2",
              message: "second page",
              fields: {},
            },
          ]),
        );

      const res = await app
        .post("/api/v1/logs/search")
        .set("Authorization", "Bearer sess_admin")
        .send({ teamId: "t1", limit: 5, offset: 5 });

      expect(res.status).toBe(200);
      expect(res.body.logs[0].message).toBe("second page");
      expect(mockedClickhouse.query).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          query_params: expect.objectContaining({ limit: 5, offset: 5 }),
        }),
      );
    });

    it("passes the level filter to log search", async () => {
      mockedPrisma.session.findUnique.mockResolvedValueOnce(makeSession({ userId: "user-1" }));
      mockedPrisma.teamMember.findUnique.mockResolvedValueOnce({
        id: "member-1",
        teamId: "t1",
        userId: "user-1",
        role: "MEMBER",
        joinedAt: new Date("2026-03-23T00:00:00.000Z"),
      });
      mockedClickhouse.query
        .mockResolvedValueOnce(makeClickhouseResult([{ total: "1" }]))
        .mockResolvedValueOnce(
          makeClickhouseResult([
            {
              team_id: "t1",
              source_id: "s1",
              timestamp: "2026-03-23 10:00:00.000",
              level: "error",
              service: "billing",
              host: "api-1",
              message: "error log",
              fields: {},
            },
          ]),
        );

      const res = await app
        .post("/api/v1/logs/search")
        .set("Authorization", "Bearer sess_admin")
        .send({
          teamId: "t1",
          filters: [{ field: "level", operator: "eq", value: "error" }],
        });

      expect(res.status).toBe(200);
      expect(res.body.logs[0].level).toBe("error");
      expect(mockedClickhouse.query).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          query: expect.stringContaining("level = {f0:String}"),
          query_params: expect.objectContaining({ f0: "error" }),
        }),
      );
    });

    it("passes the service filter to log search", async () => {
      mockedPrisma.session.findUnique.mockResolvedValueOnce(makeSession({ userId: "user-1" }));
      mockedPrisma.teamMember.findUnique.mockResolvedValueOnce({
        id: "member-1",
        teamId: "t1",
        userId: "user-1",
        role: "MEMBER",
        joinedAt: new Date("2026-03-23T00:00:00.000Z"),
      });
      mockedClickhouse.query
        .mockResolvedValueOnce(makeClickhouseResult([{ total: "1" }]))
        .mockResolvedValueOnce(
          makeClickhouseResult([
            {
              team_id: "t1",
              source_id: "s1",
              timestamp: "2026-03-23 10:00:00.000",
              level: "info",
              service: "payment-api",
              host: "api-1",
              message: "service log",
              fields: {},
            },
          ]),
        );

      const res = await app
        .post("/api/v1/logs/search")
        .set("Authorization", "Bearer sess_admin")
        .send({
          teamId: "t1",
          filters: [{ field: "service", operator: "contains", value: "payment" }],
        });

      expect(res.status).toBe(200);
      expect(res.body.logs[0].service).toBe("payment-api");
      expect(mockedClickhouse.query).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          query: expect.stringContaining("service ILIKE {f0:String}"),
          query_params: expect.objectContaining({ f0: "%payment%" }),
        }),
      );
    });

    it("supports normalized pattern filter", async () => {
      mockedPrisma.session.findUnique.mockResolvedValueOnce(makeSession({ userId: "user-1" }));
      mockedPrisma.teamMember.findUnique.mockResolvedValueOnce({
        id: "member-1",
        teamId: "t1",
        userId: "user-1",
        role: "MEMBER",
        joinedAt: new Date("2026-03-23T00:00:00.000Z"),
      });
      mockedClickhouse.query
        .mockResolvedValueOnce(makeClickhouseResult([{ total: "1" }]))
        .mockResolvedValueOnce(
          makeClickhouseResult([
            {
              team_id: "t1",
              source_id: "s1",
              timestamp: "2026-03-23 10:00:00.000",
              level: "error",
              service: "payment-api",
              host: "api-1",
              message: "Error user 123 failed",
              fields: {},
            },
          ]),
        );

      const res = await app
        .post("/api/v1/logs/search")
        .set("Authorization", "Bearer sess_admin")
        .send({
          teamId: "t1",
          filters: [{ field: "__pattern", operator: "eq", value: "error <id> failed" }],
        });

      expect(res.status).toBe(200);
      expect(mockedClickhouse.query).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          query: expect.stringContaining("replaceRegexpAll("),
          query_params: expect.objectContaining({ f0: "error <id> failed" }),
        }),
      );
    });

    it("rejects POST /api/v1/logs/search when the authed user is not a team member (cross-team)", async () => {
      mockedPrisma.session.findUnique.mockResolvedValueOnce(makeSession({ userId: "user-1" }));
      mockedPrisma.teamMember.findUnique.mockResolvedValueOnce(null);
      const res = await app
        .post("/api/v1/logs/search")
        .set("Authorization", "Bearer sess_admin")
        .send({ teamId: "other-team" });
      expect(res.status).toBe(403);
      expect(mockedPrisma.teamMember.findUnique).toHaveBeenCalledWith({
        where: { teamId_userId: { teamId: "other-team", userId: "user-1" } },
      });
    });
  });

  describe("POST /api/v1/logs/facets", () => {
    it("rejects missing teamId", async () => {
      mockedPrisma.session.findUnique.mockResolvedValueOnce(makeSession({ userId: "user-1" }));
      const res = await app.post("/api/v1/logs/facets").set("Authorization", "Bearer sess_admin").send({});
      expect(res.status).toBe(400);
    });

    it("returns facet buckets for requested fields", async () => {
      mockedPrisma.session.findUnique.mockResolvedValueOnce(makeSession({ userId: "user-1" }));
      mockedPrisma.teamMember.findUnique.mockResolvedValueOnce({
        id: "member-1",
        teamId: "t1",
        userId: "user-1",
        role: "MEMBER",
        joinedAt: new Date("2026-03-23T00:00:00.000Z"),
      });
      mockedClickhouse.query
        .mockResolvedValueOnce(
          makeClickhouseResult([
            { value: "payment-api", count: "7" },
            { value: "billing-api", count: "4" },
          ]),
        )
        .mockResolvedValueOnce(
          makeClickhouseResult([
            { value: "error", count: "6" },
            { value: "warn", count: "3" },
          ]),
        );

      const res = await app
        .post("/api/v1/logs/facets")
        .set("Authorization", "Bearer sess_admin")
        .send({
          teamId: "t1",
          fields: ["service", "level"],
          limit: 5,
        });

      expect(res.status).toBe(200);
      expect(res.body.facets).toHaveLength(2);
      expect(res.body.facets[0].field).toBe("service");
      expect(res.body.facets[0].buckets[0]).toEqual({ value: "payment-api", count: 7 });
      expect(mockedClickhouse.query).toHaveBeenCalledWith(
        expect.objectContaining({
          query: expect.stringContaining("GROUP BY value"),
          query_params: expect.objectContaining({ facetLimit: 5 }),
        }),
      );
    });

    it("supports async mode and returns job envelope", async () => {
      mockedPrisma.session.findUnique.mockResolvedValueOnce(makeSession({ userId: "user-1" }));
      mockedPrisma.teamMember.findUnique.mockResolvedValueOnce({
        id: "member-1",
        teamId: "t1",
        userId: "user-1",
        role: "MEMBER",
        joinedAt: new Date("2026-03-23T00:00:00.000Z"),
      });
      mockedClickhouse.query.mockResolvedValue(makeClickhouseResult([{ value: "api", count: "1" }]));

      const res = await app
        .post("/api/v1/logs/facets")
        .set("Authorization", "Bearer sess_admin")
        .send({
          teamId: "t1",
          fields: ["service"],
          async: true,
        });

      expect(res.status).toBe(202);
      expect(res.body.requestId).toBeTruthy();
      expect(res.body.status).toBe("pending");
    });
  });

  describe("POST /api/v1/logs/histogram", () => {
    it("rejects missing teamId", async () => {
      mockedPrisma.session.findUnique.mockResolvedValueOnce(makeSession({ userId: "user-1" }));
      const res = await app.post("/api/v1/logs/histogram").set("Authorization", "Bearer sess_admin").send({});
      expect(res.status).toBe(400);
    });

    it("returns histogram buckets", async () => {
      mockedPrisma.session.findUnique.mockResolvedValueOnce(makeSession({ userId: "user-1" }));
      mockedPrisma.teamMember.findUnique.mockResolvedValueOnce({
        id: "member-1",
        teamId: "t1",
        userId: "user-1",
        role: "MEMBER",
        joinedAt: new Date("2026-03-23T00:00:00.000Z"),
      });
      mockedClickhouse.query.mockResolvedValueOnce(
        makeClickhouseResult([
          { bucket_start: "2026-03-23 10:00:00", count: "10" },
          { bucket_start: "2026-03-23 10:05:00", count: "6" },
        ]),
      );

      const res = await app.post("/api/v1/logs/histogram").set("Authorization", "Bearer sess_admin").send({
        teamId: "t1",
        interval: "5m",
      });

      expect(res.status).toBe(200);
      expect(res.body.interval).toBe("5m");
      expect(res.body.buckets).toHaveLength(2);
      expect(res.body.buckets[0].count).toBe(10);
      expect(mockedClickhouse.query).toHaveBeenCalledWith(
        expect.objectContaining({
          query: expect.stringContaining("toStartOfInterval(timestamp, INTERVAL 5 MINUTE)"),
        }),
      );
    });
  });

  describe("POST /api/v1/logs/patterns", () => {
    it("rejects missing teamId", async () => {
      mockedPrisma.session.findUnique.mockResolvedValueOnce(makeSession({ userId: "user-1" }));
      const res = await app.post("/api/v1/logs/patterns").set("Authorization", "Bearer sess_admin").send({});
      expect(res.status).toBe(400);
    });

    it("returns grouped patterns", async () => {
      mockedPrisma.session.findUnique.mockResolvedValueOnce(makeSession({ userId: "user-1" }));
      mockedPrisma.teamMember.findUnique.mockResolvedValueOnce({
        id: "member-1",
        teamId: "t1",
        userId: "user-1",
        role: "MEMBER",
        joinedAt: new Date("2026-03-23T00:00:00.000Z"),
      });
      mockedClickhouse.query.mockResolvedValueOnce(
        makeClickhouseResult([
          {
            signature: "error user <id> failed",
            sample_message: "Error user 123 failed",
            count: "15",
            latest_timestamp: "2026-03-23 10:05:00",
            service: "payment-api",
            level: "error",
            sample_host: "api-1",
          },
        ]),
      );

      const res = await app.post("/api/v1/logs/patterns").set("Authorization", "Bearer sess_admin").send({
        teamId: "t1",
        groupBy: "service_level",
        limit: 20,
      });

      expect(res.status).toBe(200);
      expect(res.body.patterns).toHaveLength(1);
      expect(res.body.patterns[0].count).toBe(15);
      expect(res.body.patterns[0].service).toBe("payment-api");
      expect(mockedClickhouse.query).toHaveBeenCalledWith(
        expect.objectContaining({
          query: expect.stringContaining("GROUP BY signature, service, level"),
          query_params: expect.objectContaining({ patternLimit: 20 }),
        }),
      );
    });
  });

  describe("GET /api/v1/query/jobs/:id", () => {
    it("returns 404 for unknown job", async () => {
      mockedPrisma.session.findUnique.mockResolvedValueOnce(makeSession({ userId: "user-1" }));
      const res = await app.get("/api/v1/query/jobs/unknown-job").set("Authorization", "Bearer sess_admin");
      expect(res.status).toBe(404);
    });
  });

  describe("Saved log views API", () => {
    it("lists saved views for authenticated team member", async () => {
      mockedPrisma.session.findUnique.mockResolvedValueOnce(makeSession({ userId: "user-1" }));
      mockedPrisma.teamMember.findUnique.mockResolvedValueOnce({
        id: "member-1",
        teamId: "t1",
        userId: "user-1",
        role: "MEMBER",
        joinedAt: new Date("2026-03-23T00:00:00.000Z"),
      });
      mockedPrisma.logView.findMany.mockResolvedValueOnce([
        {
          id: "view-1",
          teamId: "t1",
          ownerUserId: "user-1",
          name: "Errors",
          isShared: false,
          isDefault: true,
          definition: { filters: [], columns: [], facets: [], exclusions: [], pageSize: 50 },
          createdAt: new Date("2026-03-23T00:00:00.000Z"),
          updatedAt: new Date("2026-03-23T00:00:00.000Z"),
        },
      ]);

      const res = await app.get("/api/v1/logs/views?teamId=t1").set("Authorization", "Bearer sess_admin");

      expect(res.status).toBe(200);
      expect(res.body.views).toHaveLength(1);
      expect(res.body.views[0].name).toBe("Errors");
    });

    it("creates a saved view", async () => {
      mockedPrisma.session.findUnique.mockResolvedValueOnce(makeSession({ userId: "user-1" }));
      mockedPrisma.teamMember.findUnique.mockResolvedValueOnce({
        id: "member-1",
        teamId: "t1",
        userId: "user-1",
        role: "MEMBER",
        joinedAt: new Date("2026-03-23T00:00:00.000Z"),
      });
      mockedPrisma.logView.create.mockResolvedValueOnce({
        id: "view-2",
        teamId: "t1",
        ownerUserId: "user-1",
        name: "Payments",
        isShared: false,
        isDefault: false,
        definition: { filters: [], columns: [], facets: [], exclusions: [], pageSize: 50 },
        createdAt: new Date("2026-03-23T00:00:00.000Z"),
        updatedAt: new Date("2026-03-23T00:00:00.000Z"),
      });

      const res = await app
        .post("/api/v1/logs/views")
        .set("Authorization", "Bearer sess_admin")
        .send({
          teamId: "t1",
          name: "Payments",
          isShared: false,
          isDefault: false,
          definition: { filters: [], columns: [], facets: [], exclusions: [], pageSize: 50 },
        });

      expect(res.status).toBe(201);
      expect(res.body.view.name).toBe("Payments");
      expect(mockedPrisma.logView.create).toHaveBeenCalled();
    });

    it("updates a saved view", async () => {
      mockedPrisma.session.findUnique.mockResolvedValueOnce(makeSession({ userId: "user-1" }));
      mockedPrisma.teamMember.findUnique.mockResolvedValueOnce({
        id: "member-1",
        teamId: "t1",
        userId: "user-1",
        role: "MEMBER",
        joinedAt: new Date("2026-03-23T00:00:00.000Z"),
      });
      mockedPrisma.logView.findUnique.mockResolvedValueOnce({
        id: "view-3",
        teamId: "t1",
        ownerUserId: "user-1",
        name: "Old name",
        isShared: false,
        isDefault: false,
        definition: { filters: [], columns: [], facets: [], exclusions: [], pageSize: 50 },
        createdAt: new Date("2026-03-23T00:00:00.000Z"),
        updatedAt: new Date("2026-03-23T00:00:00.000Z"),
      });
      mockedPrisma.logView.update.mockResolvedValueOnce({
        id: "view-3",
        teamId: "t1",
        ownerUserId: "user-1",
        name: "New name",
        isShared: false,
        isDefault: false,
        definition: { filters: [], columns: [], facets: [], exclusions: [], pageSize: 50 },
        createdAt: new Date("2026-03-23T00:00:00.000Z"),
        updatedAt: new Date("2026-03-23T00:00:00.000Z"),
      });

      const res = await app
        .put("/api/v1/logs/views/view-3?teamId=t1")
        .set("Authorization", "Bearer sess_admin")
        .send({ name: "New name" });

      expect(res.status).toBe(200);
      expect(res.body.view.name).toBe("New name");
      expect(mockedPrisma.logView.update).toHaveBeenCalled();
    });

    it("deletes a saved view", async () => {
      mockedPrisma.session.findUnique.mockResolvedValueOnce(makeSession({ userId: "user-1" }));
      mockedPrisma.teamMember.findUnique.mockResolvedValueOnce({
        id: "member-1",
        teamId: "t1",
        userId: "user-1",
        role: "MEMBER",
        joinedAt: new Date("2026-03-23T00:00:00.000Z"),
      });
      mockedPrisma.logView.findUnique.mockResolvedValueOnce({
        id: "view-4",
        teamId: "t1",
        ownerUserId: "user-1",
        name: "Delete me",
        isShared: false,
        isDefault: false,
        definition: { filters: [], columns: [], facets: [], exclusions: [], pageSize: 50 },
        createdAt: new Date("2026-03-23T00:00:00.000Z"),
        updatedAt: new Date("2026-03-23T00:00:00.000Z"),
      });

      const res = await app
        .delete("/api/v1/logs/views/view-4?teamId=t1")
        .set("Authorization", "Bearer sess_admin");

      expect(res.status).toBe(204);
      expect(mockedPrisma.logView.delete).toHaveBeenCalledWith({ where: { id: "view-4" } });
    });
  });

  describe("GET /api/v1/alerts/rules", () => {
    it("rejects missing teamId", async () => {
      mockedPrisma.session.findUnique.mockResolvedValueOnce(makeSession({ userId: "user-1" }));
      const res = await app.get("/api/v1/alerts/rules").set("Authorization", "Bearer sess_admin");
      expect(res.status).toBe(400);
    });

    it("returns rules for teamId", async () => {
      mockedPrisma.session.findUnique.mockResolvedValueOnce(makeSession({ userId: "user-1" }));
      mockedPrisma.teamMember.findUnique.mockResolvedValueOnce({
        id: "member-1",
        teamId: "t1",
        userId: "user-1",
        role: "MEMBER",
        joinedAt: new Date("2026-03-23T00:00:00.000Z"),
      });
      const res = await app.get("/api/v1/alerts/rules?teamId=t1").set("Authorization", "Bearer sess_admin");
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("rules");
    });

    it("rejects GET /api/v1/alerts/rules when the authed user is not a team member (cross-team)", async () => {
      mockedPrisma.session.findUnique.mockResolvedValueOnce(makeSession({ userId: "user-1" }));
      mockedPrisma.teamMember.findUnique.mockResolvedValueOnce(null);
      const res = await app
        .get("/api/v1/alerts/rules?teamId=other-team")
        .set("Authorization", "Bearer sess_admin");
      expect(res.status).toBe(403);
      expect(mockedPrisma.teamMember.findUnique).toHaveBeenCalledWith({
        where: { teamId_userId: { teamId: "other-team", userId: "user-1" } },
      });
    });
  });

  describe("GET /api/v1/alerts/incidents", () => {
    it("rejects missing teamId", async () => {
      mockedPrisma.session.findUnique.mockResolvedValueOnce(makeSession({ userId: "user-1" }));
      const res = await app.get("/api/v1/alerts/incidents").set("Authorization", "Bearer sess_admin");
      expect(res.status).toBe(400);
    });
  });

  describe("GET /api/v1/dashboards/overview", () => {
    it("rejects missing teamId", async () => {
      mockedPrisma.session.findUnique.mockResolvedValueOnce(makeSession({ userId: "user-1" }));
      const res = await app.get("/api/v1/dashboards/overview").set("Authorization", "Bearer sess_admin");
      expect(res.status).toBe(400);
    });
  });

  describe("POST /api/v1/query/natural", () => {
    it("rejects missing query", async () => {
      mockedPrisma.session.findUnique.mockResolvedValueOnce(makeSession({ userId: "user-1" }));
      const res = await app
        .post("/api/v1/query/natural")
        .set("Authorization", "Bearer sess_admin")
        .send({ teamId: "t1" });
      expect(res.status).toBe(400);
    });

    it("translates natural query", async () => {
      mockedPrisma.session.findUnique.mockResolvedValueOnce(makeSession({ userId: "user-1" }));
      mockedPrisma.teamMember.findUnique.mockResolvedValueOnce({
        id: "member-1",
        teamId: "t1",
        userId: "user-1",
        role: "MEMBER",
        joinedAt: new Date("2026-03-23T00:00:00.000Z"),
      });
      const res = await app
        .post("/api/v1/query/natural")
        .set("Authorization", "Bearer sess_admin")
        .send({ teamId: "t1", query: "show errors" });
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("explanation");
      expect(res.body).toHaveProperty("filtersApplied");
      expect(res.body).not.toHaveProperty("sql");
    });
  });

  describe("Auth gates on log + query endpoints", () => {
    it("rejects POST /api/v1/logs/search without Authorization", async () => {
      const res = await app.post("/api/v1/logs/search").send({ teamId: "t1" });
      expect(res.status).toBe(401);
    });

    it("rejects POST /api/v1/query/natural without Authorization", async () => {
      const res = await app.post("/api/v1/query/natural").send({ teamId: "t1", query: "show errors" });
      expect(res.status).toBe(401);
    });

    it("rejects GET /api/v1/logs without Authorization", async () => {
      const res = await app.get("/api/v1/logs?teamId=t1");
      expect(res.status).toBe(401);
    });

    it("rejects POST /api/v1/logs/context without Authorization", async () => {
      const res = await app.post("/api/v1/logs/context").send({ teamId: "t1" });
      expect(res.status).toBe(401);
    });

    it("rejects POST /api/v1/logs/facets without Authorization", async () => {
      const res = await app.post("/api/v1/logs/facets").send({ teamId: "t1" });
      expect(res.status).toBe(401);
    });

    it("rejects POST /api/v1/logs/histogram without Authorization", async () => {
      const res = await app.post("/api/v1/logs/histogram").send({ teamId: "t1" });
      expect(res.status).toBe(401);
    });

    it("rejects POST /api/v1/logs/patterns without Authorization", async () => {
      const res = await app.post("/api/v1/logs/patterns").send({ teamId: "t1" });
      expect(res.status).toBe(401);
    });

    it("rejects GET /api/v1/query/jobs/:id without Authorization", async () => {
      const res = await app.get("/api/v1/query/jobs/some-id");
      expect(res.status).toBe(401);
    });

    it("rejects GET /api/v1/logs/:id without Authorization", async () => {
      const res = await app.get("/api/v1/logs/abc?teamId=t1");
      expect(res.status).toBe(401);
    });
  });

  describe("Auth gates on remaining endpoints", () => {
    it("rejects GET /api/v1/sources without Authorization", async () => {
      const res = await app.get("/api/v1/sources?teamId=t1");
      expect(res.status).toBe(401);
    });

    it("rejects POST /api/v1/sources without Authorization", async () => {
      const res = await app.post("/api/v1/sources").send({ teamId: "t1", name: "s", type: "API" });
      expect(res.status).toBe(401);
    });

    it("rejects GET /api/v1/alerts/rules without Authorization", async () => {
      const res = await app.get("/api/v1/alerts/rules?teamId=t1");
      expect(res.status).toBe(401);
    });

    it("rejects GET /api/v1/alerts/incidents without Authorization", async () => {
      const res = await app.get("/api/v1/alerts/incidents?teamId=t1");
      expect(res.status).toBe(401);
    });

    it("rejects GET /api/v1/maintenance-windows without Authorization", async () => {
      const res = await app.get("/api/v1/maintenance-windows?teamId=t1");
      expect(res.status).toBe(401);
    });

    it("rejects GET /api/v1/dashboards/overview without Authorization", async () => {
      const res = await app.get("/api/v1/dashboards/overview?teamId=t1");
      expect(res.status).toBe(401);
    });

    it("rejects GET /api/v1/issues without Authorization", async () => {
      const res = await app.get("/api/v1/issues?teamId=t1");
      expect(res.status).toBe(401);
    });

    it("rejects GET /api/v1/issues/:id without Authorization", async () => {
      const res = await app.get("/api/v1/issues/issue-1");
      expect(res.status).toBe(401);
    });

    it("rejects GET /api/v1/stream/logs without Authorization", async () => {
      const res = await app.get("/api/v1/stream/logs?teamId=t1");
      expect(res.status).toBe(401);
    });

    it("rejects GET /api/v1/stream/logs with an invalid ?token= query", async () => {
      mockedPrisma.session.findUnique.mockResolvedValue(null);
      const res = await app.get("/api/v1/stream/logs?teamId=t1&token=bogus");
      expect(res.status).toBe(401);
      expect(mockedPrisma.session.findUnique).toHaveBeenCalledWith({
        where: { token: "bogus" },
      });
    });

    it("rejects GET /api/v1/stream/logs when the authed user is not a team member (cross-team)", async () => {
      mockedPrisma.session.findUnique.mockResolvedValueOnce(makeSession({ userId: "user-1" }));
      mockedPrisma.teamMember.findUnique.mockResolvedValueOnce(null);
      const res = await app
        .get("/api/v1/stream/logs?teamId=other-team")
        .set("Authorization", "Bearer sess_admin");
      expect(res.status).toBe(403);
      expect(mockedPrisma.teamMember.findUnique).toHaveBeenCalledWith({
        where: { teamId_userId: { teamId: "other-team", userId: "user-1" } },
      });
    });

    it("rejects POST /api/v1/alerts/rules/:id/mute without Authorization (401 not 400)", async () => {
      const res = await app.post("/api/v1/alerts/rules/rule-1/mute").send({ durationMinutes: 30 });
      expect(res.status).toBe(401);
    });

    it("rejects POST /api/v1/alerts/rules/:id/unmute without Authorization (401 not 400)", async () => {
      const res = await app.post("/api/v1/alerts/rules/rule-1/unmute");
      expect(res.status).toBe(401);
    });
  });

  // Negative-control: a positive case proves the auth gate is not a
  // hard-block. Uses GET /logs/views because that route threads userId
  // through requireTeamRole and into logViewService.list, so the
  // control exercises the userId plumbing end-to-end (not just the
  // existence of the auth check).
  describe("Auth gate negative control", () => {
    it("allows GET /api/v1/logs/views?teamId=t1 with a valid bearer token", async () => {
      mockedPrisma.session.findUnique.mockResolvedValueOnce(makeSession({ userId: "user-1" }));
      mockedPrisma.teamMember.findUnique.mockResolvedValueOnce({
        id: "member-1",
        teamId: "t1",
        userId: "user-1",
        role: "MEMBER",
        joinedAt: new Date("2026-03-23T00:00:00.000Z"),
      });
      mockedPrisma.logView.findMany.mockResolvedValueOnce([]);

      const res = await app.get("/api/v1/logs/views?teamId=t1").set("Authorization", "Bearer sess_admin");
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("views");
    });
  });

  // Provable claim: the README states "Bearer-token auth except /ingest/*
  // (API key) and /auth/*". This walks every registered route and asserts
  // each non-public path rejects an unauthenticated request with 401.
  // Catches accidental regressions when new handlers are added.
  describe("Route auth audit", () => {
    const PUBLIC_PATHS = new Set<string>(["/health", "/auth/register", "/auth/settings", "/auth/login"]);
    const API_KEY_PREFIX = "/ingest/";

    function fillParams(path: string): string {
      return path.replace(/:[A-Za-z0-9_]+/g, "placeholder");
    }

    it("rejects unauthenticated requests on every non-public /api/v1 route", async () => {
      const { apiRouter } = await import("../../src/api/rest/router.js");
      type Layer = { route?: { path: string; methods: Record<string, boolean> } };
      const stack = (apiRouter as unknown as { stack: Layer[] }).stack;
      const routes = stack
        .filter((l): l is { route: { path: string; methods: Record<string, boolean> } } =>
          Boolean(l.route?.path),
        )
        .flatMap((l) =>
          Object.keys(l.route.methods)
            .filter((m) => l.route.methods[m])
            .map((method) => ({ method: method.toUpperCase(), path: l.route.path })),
        );

      expect(routes.length).toBeGreaterThan(20);

      for (const { method, path } of routes) {
        if (PUBLIC_PATHS.has(path)) continue;
        if (path.startsWith(API_KEY_PREFIX)) {
          const res = await app[method.toLowerCase() as "get"](`/api/v1${fillParams(path)}`);
          expect(res.status, `${method} ${path} should require API key`).toBe(401);
          continue;
        }

        const filled = fillParams(path);
        const verb = method.toLowerCase() as "get" | "post" | "put" | "delete" | "patch";
        const res = await app[verb](`/api/v1${filled}`);
        expect(res.status, `${method} ${path} should require bearer auth`).toBe(401);
      }
    });
  });

  describe("GET /metrics", () => {
    it("returns Prometheus metrics", async () => {
      const res = await app.get("/metrics");
      expect(res.status).toBe(200);
      expect(res.text).toContain("telerithm_http_requests_total");
      expect(res.text).toContain("telerithm_http_request_duration_ms");
    });
  });

  describe("GET /docs", () => {
    it("serves Swagger UI", async () => {
      const res = await app.get("/docs/").redirects(1);
      expect(res.status).toBe(200);
    });
  });

  describe("GET /openapi.json", () => {
    it("returns OpenAPI spec", async () => {
      const res = await app.get("/openapi.json");
      expect(res.status).toBe(200);
      expect(res.body.openapi).toBe("3.0.3");
      expect(res.body.info.title).toBe("Telerithm API");
    });
  });

  describe("Security headers", () => {
    it("returns X-Request-Id header", async () => {
      const res = await app.get("/api/v1/health");
      expect(res.headers["x-request-id"]).toBeTruthy();
    });

    it("returns security headers from helmet", async () => {
      const res = await app.get("/api/v1/health");
      expect(res.headers["x-content-type-options"]).toBe("nosniff");
      expect(res.headers["x-frame-options"]).toBe("SAMEORIGIN");
    });
  });

  describe("Admin routes", () => {
    it("adds a user to a team with the requested role", async () => {
      mockedPrisma.session.findUnique.mockResolvedValueOnce(makeSession());
      mockedPrisma.user.findUnique.mockResolvedValueOnce(makeUser({ id: "admin-1", role: "ADMIN" }));
      mockedPrisma.teamMember.create.mockResolvedValueOnce({
        id: "member-2",
        teamId: "team-2",
        userId: "user-2",
        role: "VIEWER",
        joinedAt: new Date("2026-03-23T00:00:00.000Z"),
      });

      const res = await app
        .post("/api/v1/admin/users/user-2/add-to-team")
        .set("Authorization", "Bearer sess_admin")
        .send({ teamId: "team-2", role: "VIEWER" });

      expect(res.status).toBe(201);
      expect(res.body.membership.role).toBe("VIEWER");
      expect(mockedPrisma.teamMember.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ userId: "user-2", teamId: "team-2", role: "VIEWER" }),
        }),
      );
    });

    it("approves a pending user through the admin route", async () => {
      mockedPrisma.session.findUnique.mockResolvedValueOnce(makeSession());
      mockedPrisma.user.findUnique.mockResolvedValueOnce(makeUser({ id: "admin-1", role: "ADMIN" }));
      mockedPrisma.user.update.mockResolvedValueOnce(makeUser({ id: "user-3", status: "ACTIVE" }));

      const res = await app
        .post("/api/v1/admin/users/user-3/approve")
        .set("Authorization", "Bearer sess_admin")
        .send({});

      expect(res.status).toBe(200);
      expect(res.body.user.status).toBe("ACTIVE");
      expect(mockedPrisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "user-3" },
          data: { status: "ACTIVE" },
        }),
      );
    });
  });

  describe("GET /api/v1/issues", () => {
    it("passes query, status, sorting, limit and offset to the issue service", async () => {
      mockedPrisma.session.findUnique.mockResolvedValueOnce(makeSession({ userId: "user-1" }));
      mockedPrisma.teamMember.findUnique.mockResolvedValueOnce({
        id: "member-1",
        teamId: "t1",
        userId: "user-1",
        role: "MEMBER",
        joinedAt: new Date("2026-03-23T00:00:00.000Z"),
      });
      mockedPrisma.issue.findMany.mockResolvedValueOnce([
        {
          id: "issue-1",
          teamId: "t1",
          fingerprint: "fp-1",
          title: "Payment timeout",
          level: "error",
          service: "payment-api",
          status: "NEW",
          firstSeen: new Date("2026-03-23T00:00:00.000Z"),
          lastSeen: new Date("2026-03-23T01:00:00.000Z"),
          eventCount: 42,
          assignee: null,
        },
      ]);
      mockedPrisma.issue.count.mockResolvedValueOnce(7);

      const res = await app
        .get(
          "/api/v1/issues?teamId=t1&query=payment&status=NEW&service=api&sortBy=eventCount&sortDirection=desc&limit=2&offset=1",
        )
        .set("Authorization", "Bearer sess_admin");

      expect(res.status).toBe(200);
      expect(res.body.total).toBe(7);
      expect(mockedPrisma.issue.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            teamId: "t1",
            title: { contains: "payment", mode: "insensitive" },
            status: "NEW",
            service: { contains: "api", mode: "insensitive" },
          }),
          orderBy: { eventCount: "desc" },
          take: 2,
          skip: 1,
        }),
      );
    });

    it("rejects GET /api/v1/issues when the authed user is not a team member (cross-team)", async () => {
      mockedPrisma.session.findUnique.mockResolvedValueOnce(makeSession({ userId: "user-1" }));
      mockedPrisma.teamMember.findUnique.mockResolvedValueOnce(null);
      const res = await app.get("/api/v1/issues?teamId=other-team").set("Authorization", "Bearer sess_admin");
      expect(res.status).toBe(403);
      expect(mockedPrisma.teamMember.findUnique).toHaveBeenCalledWith({
        where: { teamId_userId: { teamId: "other-team", userId: "user-1" } },
      });
    });
  });

  // ---------------------------------------------------------------------------
  // Team invites — IDOR scoping (task 8d46bc7b)
  // ---------------------------------------------------------------------------

  describe("team invites — authz scoping", () => {
    function makeTeamInvite(overrides: Record<string, unknown> = {}) {
      return {
        id: "inv-1",
        teamId: "t1",
        email: null,
        token: "inv_abcdef0123456789abcdef01",
        role: "MEMBER",
        createdBy: "admin-1",
        expiresAt: new Date("2099-01-01T00:00:00.000Z"),
        usedAt: null,
        createdAt: new Date("2026-03-23T00:00:00.000Z"),
        ...overrides,
      };
    }

    function authAs(userId: string, membership: { teamId: string; role: string } | null) {
      mockedPrisma.session.findUnique.mockResolvedValueOnce(makeSession({ userId }));
      mockedPrisma.teamMember.findUnique.mockResolvedValueOnce(
        membership === null
          ? null
          : {
              id: "member-1",
              teamId: membership.teamId,
              userId,
              role: membership.role,
              joinedAt: new Date("2026-03-23T00:00:00.000Z"),
            },
      );
    }

    describe("GET /api/v1/teams/:id/invites", () => {
      it("rejects a non-member with 403 and never queries the invites (cross-tenant list IDOR)", async () => {
        authAs("outsider-1", null);

        const res = await app.get("/api/v1/teams/t1/invites").set("Authorization", "Bearer sess_admin");

        expect(res.status).toBe(403);
        expect(mockedPrisma.teamInvite.findMany).not.toHaveBeenCalled();
      });

      it("rejects a plain MEMBER with 403 (invite payload carries the join token)", async () => {
        authAs("member-1", { teamId: "t1", role: "MEMBER" });

        const res = await app.get("/api/v1/teams/t1/invites").set("Authorization", "Bearer sess_admin");

        expect(res.status).toBe(403);
        expect(mockedPrisma.teamInvite.findMany).not.toHaveBeenCalled();
      });

      it("returns the team's invites for an ADMIN", async () => {
        authAs("admin-1", { teamId: "t1", role: "ADMIN" });
        mockedPrisma.teamInvite.findMany.mockResolvedValueOnce([makeTeamInvite()]);

        const res = await app.get("/api/v1/teams/t1/invites").set("Authorization", "Bearer sess_admin");

        expect(res.status).toBe(200);
        expect(res.body.invites).toHaveLength(1);
        expect(mockedPrisma.teamInvite.findMany).toHaveBeenCalledWith(
          expect.objectContaining({ where: expect.objectContaining({ teamId: "t1" }) }),
        );
      });
    });

    describe("POST /api/v1/teams/:id/invites", () => {
      it("rejects a non-member with 403 and never creates an invite (cross-tenant takeover vector)", async () => {
        mockedConfig.multiTenant = true;
        authAs("outsider-1", null);

        const res = await app
          .post("/api/v1/teams/t1/invites")
          .set("Authorization", "Bearer sess_admin")
          .send({ role: "ADMIN" });

        expect(res.status).toBe(403);
        expect(mockedPrisma.teamInvite.create).not.toHaveBeenCalled();
      });

      it("rejects a plain MEMBER with 403", async () => {
        mockedConfig.multiTenant = true;
        authAs("member-1", { teamId: "t1", role: "MEMBER" });

        const res = await app
          .post("/api/v1/teams/t1/invites")
          .set("Authorization", "Bearer sess_admin")
          .send({ role: "MEMBER" });

        expect(res.status).toBe(403);
        expect(mockedPrisma.teamInvite.create).not.toHaveBeenCalled();
      });

      it("creates an invite for an OWNER", async () => {
        mockedConfig.multiTenant = true;
        authAs("owner-1", { teamId: "t1", role: "OWNER" });
        mockedPrisma.teamInvite.create.mockResolvedValueOnce(makeTeamInvite({ createdBy: "owner-1" }));

        const res = await app
          .post("/api/v1/teams/t1/invites")
          .set("Authorization", "Bearer sess_admin")
          .send({ role: "MEMBER" });

        expect(res.status).toBe(201);
        expect(res.body.invite.teamId).toBe("t1");
      });
    });

    describe("DELETE /api/v1/invites/:id", () => {
      it("returns 404 when the invite does not exist", async () => {
        mockedPrisma.session.findUnique.mockResolvedValueOnce(makeSession({ userId: "user-1" }));
        mockedPrisma.teamInvite.findUnique.mockResolvedValueOnce(null);

        const res = await app.delete("/api/v1/invites/missing").set("Authorization", "Bearer sess_admin");

        expect(res.status).toBe(404);
        expect(mockedPrisma.teamInvite.deleteMany).not.toHaveBeenCalled();
      });

      it("rejects a caller who is not a member of the invite's team with 403 and never deletes (cross-tenant revoke IDOR)", async () => {
        mockedPrisma.session.findUnique.mockResolvedValueOnce(makeSession({ userId: "outsider-1" }));
        mockedPrisma.teamInvite.findUnique.mockResolvedValueOnce(makeTeamInvite({ teamId: "t1" }));
        mockedPrisma.teamMember.findUnique.mockResolvedValueOnce(null);

        const res = await app.delete("/api/v1/invites/inv-1").set("Authorization", "Bearer sess_admin");

        expect(res.status).toBe(403);
        expect(mockedPrisma.teamInvite.deleteMany).not.toHaveBeenCalled();
      });

      it("rejects a plain MEMBER of the invite's team with 403", async () => {
        mockedPrisma.session.findUnique.mockResolvedValueOnce(makeSession({ userId: "member-1" }));
        mockedPrisma.teamInvite.findUnique.mockResolvedValueOnce(makeTeamInvite({ teamId: "t1" }));
        mockedPrisma.teamMember.findUnique.mockResolvedValueOnce({
          id: "member-1",
          teamId: "t1",
          userId: "member-1",
          role: "MEMBER",
          joinedAt: new Date("2026-03-23T00:00:00.000Z"),
        });

        const res = await app.delete("/api/v1/invites/inv-1").set("Authorization", "Bearer sess_admin");

        expect(res.status).toBe(403);
        expect(mockedPrisma.teamInvite.deleteMany).not.toHaveBeenCalled();
      });

      it("revokes the invite for an ADMIN of the invite's team, scoped to that team", async () => {
        mockedPrisma.session.findUnique.mockResolvedValueOnce(makeSession({ userId: "admin-1" }));
        mockedPrisma.teamInvite.findUnique.mockResolvedValueOnce(makeTeamInvite({ teamId: "t1" }));
        mockedPrisma.teamMember.findUnique.mockResolvedValueOnce({
          id: "member-1",
          teamId: "t1",
          userId: "admin-1",
          role: "ADMIN",
          joinedAt: new Date("2026-03-23T00:00:00.000Z"),
        });
        mockedPrisma.teamInvite.deleteMany.mockResolvedValueOnce({ count: 1 });

        const res = await app.delete("/api/v1/invites/inv-1").set("Authorization", "Bearer sess_admin");

        expect(res.status).toBe(204);
        expect(mockedPrisma.teamInvite.deleteMany).toHaveBeenCalledWith({
          where: { id: "inv-1", teamId: "t1" },
        });
      });
    });
  });

  // ---------------------------------------------------------------------------
  // Alert incidents — authz scoping (task a31d9526)
  // ---------------------------------------------------------------------------

  describe("alert incidents — authz scoping", () => {
    const MEMBERSHIP = {
      id: "member-1",
      teamId: "t1",
      userId: "user-1",
      role: "MEMBER",
      joinedAt: new Date("2026-03-23T00:00:00.000Z"),
    };

    function seedIncident(teamId = "t1") {
      mockedPrisma.alertIncident.findUnique.mockResolvedValueOnce({ rule: { teamId } });
    }

    it("acknowledge: 404 when the incident does not exist", async () => {
      mockedPrisma.session.findUnique.mockResolvedValueOnce(makeSession({ userId: "user-1" }));

      const res = await app
        .post("/api/v1/alerts/incidents/missing/acknowledge")
        .set("Authorization", "Bearer sess_admin")
        .send({});

      expect(res.status).toBe(404);
      expect(mockedPrisma.alertIncident.update).not.toHaveBeenCalled();
    });

    it("acknowledge: 403 for a non-member of the incident's team, no mutation (cross-tenant IDOR)", async () => {
      mockedPrisma.session.findUnique.mockResolvedValueOnce(makeSession({ userId: "user-1" }));
      seedIncident("t1");
      mockedPrisma.teamMember.findUnique.mockResolvedValueOnce(null);

      const res = await app
        .post("/api/v1/alerts/incidents/inc-1/acknowledge")
        .set("Authorization", "Bearer sess_admin")
        .send({});

      expect(res.status).toBe(403);
      expect(mockedPrisma.alertIncident.update).not.toHaveBeenCalled();
      expect(mockedPrisma.teamMember.findUnique).toHaveBeenCalledWith({
        where: { teamId_userId: { teamId: "t1", userId: "user-1" } },
      });
    });

    it("acknowledge: 200 for a team member, mutation runs", async () => {
      mockedPrisma.session.findUnique.mockResolvedValueOnce(makeSession({ userId: "user-1" }));
      seedIncident("t1");
      mockedPrisma.teamMember.findUnique.mockResolvedValueOnce(MEMBERSHIP);
      mockedPrisma.alertIncident.findFirst.mockResolvedValueOnce({ id: "inc-1" });
      mockedPrisma.alertIncident.update.mockResolvedValueOnce({ id: "inc-1", status: "ACKNOWLEDGED" });
      mockedPrisma.incidentEvent.create.mockResolvedValueOnce({ id: "ev-1" });

      const res = await app
        .post("/api/v1/alerts/incidents/inc-1/acknowledge")
        .set("Authorization", "Bearer sess_admin")
        .send({ comment: "on it" });

      expect(res.status).toBe(200);
      expect(res.body.incident.status).toBe("ACKNOWLEDGED");
      expect(mockedPrisma.alertIncident.findFirst).toHaveBeenCalledWith({
        where: { id: "inc-1", rule: { teamId: "t1" } },
        select: { id: true },
      });
    });

    it("resolve: 403 for a non-member, no mutation", async () => {
      mockedPrisma.session.findUnique.mockResolvedValueOnce(makeSession({ userId: "user-1" }));
      seedIncident("t1");
      mockedPrisma.teamMember.findUnique.mockResolvedValueOnce(null);

      const res = await app
        .post("/api/v1/alerts/incidents/inc-1/resolve")
        .set("Authorization", "Bearer sess_admin")
        .send({});

      expect(res.status).toBe(403);
      expect(mockedPrisma.alertIncident.update).not.toHaveBeenCalled();
    });

    it("reopen: 403 for a non-member, no mutation", async () => {
      mockedPrisma.session.findUnique.mockResolvedValueOnce(makeSession({ userId: "user-1" }));
      seedIncident("t1");
      mockedPrisma.teamMember.findUnique.mockResolvedValueOnce(null);

      const res = await app
        .post("/api/v1/alerts/incidents/inc-1/reopen")
        .set("Authorization", "Bearer sess_admin")
        .send({});

      expect(res.status).toBe(403);
      expect(mockedPrisma.alertIncident.update).not.toHaveBeenCalled();
    });

    it("timeline: 403 for a non-member, events never queried (cross-tenant disclosure)", async () => {
      mockedPrisma.session.findUnique.mockResolvedValueOnce(makeSession({ userId: "user-1" }));
      seedIncident("t1");
      mockedPrisma.teamMember.findUnique.mockResolvedValueOnce(null);

      const res = await app
        .get("/api/v1/alerts/incidents/inc-1/timeline")
        .set("Authorization", "Bearer sess_admin");

      expect(res.status).toBe(403);
      expect(mockedPrisma.incidentEvent.findMany).not.toHaveBeenCalled();
    });

    it("timeline: 200 for a team member with the team-scoped where clause", async () => {
      mockedPrisma.session.findUnique.mockResolvedValueOnce(makeSession({ userId: "user-1" }));
      seedIncident("t1");
      mockedPrisma.teamMember.findUnique.mockResolvedValueOnce(MEMBERSHIP);
      mockedPrisma.incidentEvent.findMany.mockResolvedValueOnce([]);

      const res = await app
        .get("/api/v1/alerts/incidents/inc-1/timeline")
        .set("Authorization", "Bearer sess_admin");

      expect(res.status).toBe(200);
      expect(mockedPrisma.incidentEvent.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { incidentId: "inc-1", incident: { rule: { teamId: "t1" } } },
        }),
      );
    });
  });

  // ---------------------------------------------------------------------------
  // Alert rules — mute/unmute authz scoping (task d290bcbc)
  // ---------------------------------------------------------------------------

  describe("alert-rule mute/unmute — authz scoping", () => {
    const MEMBERSHIP = {
      id: "member-1",
      teamId: "t1",
      userId: "user-1",
      role: "MEMBER",
      joinedAt: new Date("2026-03-23T00:00:00.000Z"),
    };

    function seedRule(teamId = "t1") {
      mockedPrisma.alertRule.findUnique.mockResolvedValueOnce({ teamId });
    }

    it("mute: 404 when the rule does not exist, no update", async () => {
      mockedPrisma.session.findUnique.mockResolvedValueOnce(makeSession({ userId: "user-1" }));

      const res = await app
        .post("/api/v1/alerts/rules/missing/mute")
        .set("Authorization", "Bearer sess_admin")
        .send({ durationMinutes: 30 });

      expect(res.status).toBe(404);
      expect(mockedPrisma.alertRule.update).not.toHaveBeenCalled();
    });

    it("mute: 403 for a non-member of the rule's team, no update (cross-tenant alert suppression)", async () => {
      mockedPrisma.session.findUnique.mockResolvedValueOnce(makeSession({ userId: "user-1" }));
      seedRule("t1");
      mockedPrisma.teamMember.findUnique.mockResolvedValueOnce(null);

      const res = await app
        .post("/api/v1/alerts/rules/rule-1/mute")
        .set("Authorization", "Bearer sess_admin")
        .send({ durationMinutes: 30 });

      expect(res.status).toBe(403);
      expect(mockedPrisma.alertRule.update).not.toHaveBeenCalled();
      expect(mockedPrisma.teamMember.findUnique).toHaveBeenCalledWith({
        where: { teamId_userId: { teamId: "t1", userId: "user-1" } },
      });
    });

    it("mute: 200 for a team member, update team-scoped", async () => {
      mockedPrisma.session.findUnique.mockResolvedValueOnce(makeSession({ userId: "user-1" }));
      seedRule("t1");
      mockedPrisma.teamMember.findUnique.mockResolvedValueOnce(MEMBERSHIP);
      mockedPrisma.alertRule.update.mockResolvedValueOnce({
        id: "rule-1",
        muteUntil: new Date("2026-07-12T01:00:00.000Z"),
      });

      const res = await app
        .post("/api/v1/alerts/rules/rule-1/mute")
        .set("Authorization", "Bearer sess_admin")
        .send({ durationMinutes: 30 });

      expect(res.status).toBe(200);
      expect(res.body.rule.id).toBe("rule-1");
      expect(mockedPrisma.alertRule.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: "rule-1", teamId: "t1" } }),
      );
    });

    it("unmute: 403 for a non-member of the rule's team, no update", async () => {
      mockedPrisma.session.findUnique.mockResolvedValueOnce(makeSession({ userId: "user-1" }));
      seedRule("t1");
      mockedPrisma.teamMember.findUnique.mockResolvedValueOnce(null);

      const res = await app
        .post("/api/v1/alerts/rules/rule-1/unmute")
        .set("Authorization", "Bearer sess_admin");

      expect(res.status).toBe(403);
      expect(mockedPrisma.alertRule.update).not.toHaveBeenCalled();
    });

    it("unmute: 404 when the rule does not exist, no update", async () => {
      mockedPrisma.session.findUnique.mockResolvedValueOnce(makeSession({ userId: "user-1" }));

      const res = await app
        .post("/api/v1/alerts/rules/missing/unmute")
        .set("Authorization", "Bearer sess_admin");

      expect(res.status).toBe(404);
      expect(mockedPrisma.alertRule.update).not.toHaveBeenCalled();
    });

    it("unmute: 200 for a team member, update team-scoped, muteUntil cleared", async () => {
      mockedPrisma.session.findUnique.mockResolvedValueOnce(makeSession({ userId: "user-1" }));
      seedRule("t1");
      mockedPrisma.teamMember.findUnique.mockResolvedValueOnce(MEMBERSHIP);
      mockedPrisma.alertRule.update.mockResolvedValueOnce({ id: "rule-1", muteUntil: null });

      const res = await app
        .post("/api/v1/alerts/rules/rule-1/unmute")
        .set("Authorization", "Bearer sess_admin");

      expect(res.status).toBe(200);
      expect(res.body.rule.muteUntil).toBeNull();
      expect(mockedPrisma.alertRule.update).toHaveBeenCalledWith({
        where: { id: "rule-1", teamId: "t1" },
        data: { muteUntil: null },
      });
    });

    it("mute: a malformed body is still rejected with 400 before any authz work", async () => {
      mockedPrisma.session.findUnique.mockResolvedValueOnce(makeSession({ userId: "user-1" }));

      const res = await app
        .post("/api/v1/alerts/rules/rule-1/mute")
        .set("Authorization", "Bearer sess_admin")
        .send({ durationMinutes: "forever" });

      expect(res.status).toBe(400);
      expect(mockedPrisma.alertRule.findUnique).not.toHaveBeenCalled();
      expect(mockedPrisma.alertRule.update).not.toHaveBeenCalled();
    });
  });
});
