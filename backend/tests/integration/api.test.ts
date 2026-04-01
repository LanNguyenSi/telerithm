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
    },
    alertIncident: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    issue: {
      findMany: vi.fn().mockResolvedValue([]),
      findUnique: vi.fn(),
      update: vi.fn(),
      count: vi.fn().mockResolvedValue(0),
      upsert: vi.fn(),
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

let app: supertest.Agent;

const mockedConfig = config;
const mockedPrisma = prisma as typeof prisma & {
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
  issue: {
    findMany: ReturnType<typeof vi.fn>;
    findUnique: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    count: ReturnType<typeof vi.fn>;
    upsert: ReturnType<typeof vi.fn>;
  };
};
const mockedClickhouse = clickhouse as typeof clickhouse & {
  query: ReturnType<typeof vi.fn>;
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
  vi.clearAllMocks();

  mockedConfig.multiTenant = false;
  mockedConfig.registrationMode = "approval";
  mockedConfig.adminEmail = "admin@test.com";

  mockedPrisma.user.findUnique.mockResolvedValue(null);
  mockedPrisma.user.create.mockResolvedValue(makeUser());
  mockedPrisma.user.update.mockResolvedValue(makeUser());
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
  mockedPrisma.teamMember.findUnique.mockResolvedValue(null);
  mockedPrisma.teamMember.findFirst.mockResolvedValue(null);
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
  mockedPrisma.issue.findMany.mockResolvedValue([]);
  mockedPrisma.issue.count.mockResolvedValue(0);
  mockedPrisma.logView.findMany.mockResolvedValue([]);
  mockedPrisma.logView.updateMany.mockResolvedValue({ count: 0 });
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

  describe("GET /api/v1/sources", () => {
    it("rejects missing teamId", async () => {
      const res = await app.get("/api/v1/sources");
      expect(res.status).toBe(400);
      expect(res.body.error).toBe("teamId is required");
    });

    it("returns sources for teamId", async () => {
      const res = await app.get("/api/v1/sources?teamId=t1");
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("sources");
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
      const res = await app.post("/api/v1/logs/search").send({});
      expect(res.status).toBe(400);
    });

    it("supports offset pagination and returns total count", async () => {
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

      const res = await app.post("/api/v1/logs/search").send({ teamId: "t1", limit: 5, offset: 0 });

      expect(res.status).toBe(200);
      expect(res.body.total).toBe(12);
      expect(res.body.logs).toHaveLength(1);
      expect(mockedClickhouse.query).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          query_params: expect.objectContaining({ limit: 5, offset: 0 }),
        }),
      );
    });

    it("returns the next page when offset advances", async () => {
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

      const res = await app.post("/api/v1/logs/search").send({ teamId: "t1", limit: 5, offset: 5 });

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

      const res = await app.post("/api/v1/logs/search").send({
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

      const res = await app.post("/api/v1/logs/search").send({
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
  });

  describe("POST /api/v1/logs/facets", () => {
    it("rejects missing teamId", async () => {
      const res = await app.post("/api/v1/logs/facets").send({});
      expect(res.status).toBe(400);
    });

    it("returns facet buckets for requested fields", async () => {
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

      const res = await app.post("/api/v1/logs/facets").send({
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
  });

  describe("POST /api/v1/logs/histogram", () => {
    it("rejects missing teamId", async () => {
      const res = await app.post("/api/v1/logs/histogram").send({});
      expect(res.status).toBe(400);
    });

    it("returns histogram buckets", async () => {
      mockedClickhouse.query.mockResolvedValueOnce(
        makeClickhouseResult([
          { bucket_start: "2026-03-23 10:00:00", count: "10" },
          { bucket_start: "2026-03-23 10:05:00", count: "6" },
        ]),
      );

      const res = await app.post("/api/v1/logs/histogram").send({
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
      const res = await app.get("/api/v1/alerts/rules");
      expect(res.status).toBe(400);
    });

    it("returns rules for teamId", async () => {
      const res = await app.get("/api/v1/alerts/rules?teamId=t1");
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("rules");
    });
  });

  describe("GET /api/v1/alerts/incidents", () => {
    it("rejects missing teamId", async () => {
      const res = await app.get("/api/v1/alerts/incidents");
      expect(res.status).toBe(400);
    });
  });

  describe("GET /api/v1/dashboards/overview", () => {
    it("rejects missing teamId", async () => {
      const res = await app.get("/api/v1/dashboards/overview");
      expect(res.status).toBe(400);
    });
  });

  describe("POST /api/v1/query/natural", () => {
    it("rejects missing query", async () => {
      const res = await app.post("/api/v1/query/natural").send({ teamId: "t1" });
      expect(res.status).toBe(400);
    });

    it("translates natural query", async () => {
      const res = await app.post("/api/v1/query/natural").send({ teamId: "t1", query: "show errors" });
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("sql");
      expect(res.body).toHaveProperty("explanation");
      expect(res.body).toHaveProperty("filtersApplied");
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

      const res = await app.get(
        "/api/v1/issues?teamId=t1&query=payment&status=NEW&service=api&sortBy=eventCount&sortDirection=desc&limit=2&offset=1",
      );

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
  });
});
