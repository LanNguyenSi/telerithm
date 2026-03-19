import { describe, expect, it, vi, beforeAll } from "vitest";
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
    },
    session: {
      findUnique: vi.fn(),
      create: vi.fn(),
    },
    team: {
      create: vi.fn(),
    },
    teamMember: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    logSource: {
      findUnique: vi.fn(),
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn(),
    },
    alertRule: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    alertIncident: {
      findMany: vi.fn().mockResolvedValue([]),
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

let app: supertest.Agent;

beforeAll(async () => {
  const { createApp } = await import("../../src/app.js");
  app = supertest(createApp());
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
      const res = await app
        .post("/api/v1/ingest/source-1")
        .send({ logs: ["test log"] });
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
      const res = await app
        .post("/api/v1/ingest/source-1")
        .send({});
      // Missing X-API-Key header → 401 before body validation
      expect(res.status).toBe(401);
    });
  });

  describe("POST /api/v1/logs/search", () => {
    it("rejects missing teamId", async () => {
      const res = await app.post("/api/v1/logs/search").send({});
      expect(res.status).toBe(400);
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
      const res = await app
        .post("/api/v1/query/natural")
        .send({ teamId: "t1", query: "show errors" });
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
      expect(res.text).toContain("logforge_http_requests_total");
      expect(res.text).toContain("logforge_http_request_duration_ms");
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
      expect(res.body.info.title).toBe("LogForge API");
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
});
