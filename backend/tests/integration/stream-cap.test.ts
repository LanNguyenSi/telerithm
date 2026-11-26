import { request, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// The per-user cap on GET /stream/logs through the real route, the real
// StreamingService and real sockets. The cap is 3 here (config mock). The gauge
// and the log:new listener count show what a stream leaves behind.

const { events, gauge, redisEntries } = await vi.hoisted(async () => {
  const { EventEmitter } = await import("node:events");
  return {
    events: new EventEmitter(),
    gauge: { open: 0 },
    redisEntries: new Map<string, { value: string; expiresAt: number }>(),
  };
});

vi.mock("../../src/ingestion/ingestion-service.js", () => ({
  IngestBatchTooLargeError: class IngestBatchTooLargeError extends Error {},
  IngestionService: class {
    events = events;
    ingest = vi.fn();
  },
}));

vi.mock("../../src/metrics/index.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../src/metrics/index.js")>();
  return {
    ...original,
    activeConnections: {
      inc: () => {
        gauge.open += 1;
      },
      dec: () => {
        gauge.open -= 1;
      },
    },
  };
});

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
    naturalQueryRateLimitWindowMs: 60_000,
    naturalQueryRateLimitMax: 1000,
    alertRulesMaxPerTeam: 100,
    maxStreamsPerUser: 3,
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

type Mock = ReturnType<typeof vi.fn>;
const db = prisma as unknown as {
  session: { findUnique: Mock };
  teamMember: { findUnique: Mock };
};

let server: Server;
let port: number;

beforeAll(async () => {
  const { createApp } = await import("../../src/app.js");
  server = await new Promise<Server>((resolve, reject) => {
    const s = createApp().listen(0);
    s.once("listening", () => resolve(s));
    s.once("error", reject);
  });
  port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
});

function sessionFor(token: string, userId: string) {
  return {
    id: `row-${token}`,
    userId,
    token,
    expiresAt: new Date("2099-01-01T00:00:00.000Z"),
    user: { status: "ACTIVE" },
  };
}

const ROWS = [sessionFor("sess_a", "u1"), sessionFor("sess_b", "u2")];

function mockSessions(...rows: Array<ReturnType<typeof sessionFor>>) {
  db.session.findUnique.mockImplementation(
    async ({ where }: { where: { token?: string; id?: string } }) =>
      rows.find((row) => (where.token !== undefined ? row.token === where.token : row.id === where.id)) ??
      null,
  );
}

const MEMBERS: Record<string, string[]> = { u1: ["t1", "t2"], u2: ["t1"] };

function mockMembership(members: Record<string, string[]> = MEMBERS) {
  db.teamMember.findUnique.mockImplementation(
    async ({ where }: { where: { teamId_userId: { teamId: string; userId: string } } }) => {
      const { teamId, userId } = where.teamId_userId;
      return (members[userId] ?? []).includes(teamId) ? { id: "tm", teamId, userId, role: "MEMBER" } : null;
    },
  );
}

type Opened = {
  status: number;
  contentType: string | undefined;
  body: string;
  res: IncomingMessage;
  abort: () => void;
};

// Sends one GET and resolves on the response head. An SSE stream stays open
// until abort() destroys the socket; a refusal is read to its end.
function get(path: string, headers: Record<string, string> = {}): Promise<Opened> {
  return new Promise((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port, path, headers }, (res) => {
      const opened: Opened = {
        status: res.statusCode ?? 0,
        contentType: res.headers["content-type"],
        body: "",
        res,
        abort: () => req.destroy(),
      };
      if (opened.status !== 200) {
        res.setEncoding("utf8");
        res.on("data", (chunk) => (opened.body += chunk));
        res.on("end", () => resolve(opened));
      } else {
        res.resume();
        resolve(opened);
      }
    });
    req.on("error", (error) => {
      if (!req.destroyed) reject(error);
    });
    req.end();
  });
}

const byHeader = (token: string, teamId = "t1") =>
  get(`/api/v1/stream/logs?teamId=${teamId}`, { Authorization: `Bearer ${token}` });

async function byTicket(token: string, teamId = "t1") {
  const res = await fetch(`http://127.0.0.1:${port}/api/v1/stream/ticket`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ teamId }),
  });
  expect(res.status).toBe(201);
  const { ticket } = (await res.json()) as { ticket: string };
  return get(`/api/v1/stream/logs?teamId=${teamId}&ticket=${encodeURIComponent(ticket)}`);
}

const open: Opened[] = [];
async function keep(pending: Promise<Opened>) {
  const stream = await pending;
  open.push(stream);
  return stream;
}

const settle = (ms = 50) => new Promise((resolve) => setTimeout(resolve, ms));

beforeEach(() => {
  redisEntries.clear();
  gauge.open = 0;
  db.session.findUnique.mockReset();
  db.teamMember.findUnique.mockReset();
  mockSessions(...ROWS);
  mockMembership();
});

afterEach(async () => {
  vi.useRealTimers();
  for (const stream of open.splice(0)) stream.abort();
  await vi.waitFor(() => {
    expect(gauge.open).toBe(0);
    expect(events.listenerCount("log:new")).toBe(0);
  });
});

describe("GET /api/v1/stream/logs per-user cap", () => {
  it("answers the fourth open stream of one user with 429 and no stream headers", async () => {
    for (let i = 0; i < 3; i++) expect((await keep(byHeader("sess_a"))).status).toBe(200);

    const refused = await byHeader("sess_a");

    expect(refused.status).toBe(429);
    expect(refused.contentType).toMatch(/application\/json/);
    expect(JSON.parse(refused.body)).toEqual({ error: "Too many open live tail streams" });
    expect(gauge.open).toBe(3);
    expect(events.listenerCount("log:new")).toBe(3);
  });

  it("does not hold another user to the first user's streams", async () => {
    for (let i = 0; i < 3; i++) await keep(byHeader("sess_a"));

    const other = await keep(byHeader("sess_b"));

    expect(other.status).toBe(200);
  });

  it("counts one user's streams across teams together", async () => {
    await keep(byHeader("sess_a", "t1"));
    await keep(byHeader("sess_a", "t2"));
    await keep(byHeader("sess_a", "t1"));

    expect((await byHeader("sess_a", "t2")).status).toBe(429);
  });

  it("counts streams opened with a ticket and with the header together", async () => {
    await keep(byHeader("sess_a"));
    await keep(byTicket("sess_a"));
    await keep(byTicket("sess_a"));

    expect((await byHeader("sess_a")).status).toBe(429);
    expect((await byTicket("sess_a")).status).toBe(429);
  });

  it("does not count a refused request (401, 403) against the cap", async () => {
    expect((await byHeader("sess_unknown")).status).toBe(401);
    expect((await byHeader("sess_b", "t2")).status).toBe(403);
    for (let i = 0; i < 3; i++) expect((await keep(byHeader("sess_b"))).status).toBe(200);
  });

  it("opens a new stream once one of the open ones is closed by the client", async () => {
    const streams: Opened[] = [];
    for (let i = 0; i < 3; i++) streams.push(await keep(byHeader("sess_a")));
    expect((await byHeader("sess_a")).status).toBe(429);

    streams[0].abort();

    await vi.waitFor(async () => {
      const again = await byHeader("sess_a");
      if (again.status === 200) open.push(again);
      expect(again.status).toBe(200);
    });
    expect(gauge.open).toBe(3);
    expect((await byHeader("sess_a")).status).toBe(429);
  });

  it("opens a new stream once the server has closed the open ones at a failed heartbeat check", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const streams: Opened[] = [];
    for (let i = 0; i < 3; i++) streams.push(await keep(byHeader("sess_a")));
    const ended = streams.map((s) => new Promise<void>((resolve) => s.res.on("close", () => resolve())));
    mockSessions(ROWS[1]);

    await vi.advanceTimersByTimeAsync(15000);
    await Promise.all(ended);

    mockSessions(...ROWS);
    expect(gauge.open).toBe(0);
    for (let i = 0; i < 3; i++) expect((await keep(byHeader("sess_a"))).status).toBe(200);
    expect((await byHeader("sess_a")).status).toBe(429);
  });

  describe("a client that leaves before the stream is subscribed", () => {
    // The team lookup is the last await before subscribe; hold it so the client
    // can leave while the handler is still waiting.
    async function abortWhileHeld(path: string, headers: Record<string, string>) {
      let release!: () => void;
      const held = new Promise<void>((resolve) => (release = resolve));
      const before = db.teamMember.findUnique.getMockImplementation() as (args: never) => unknown;
      let reached = false;
      db.teamMember.findUnique.mockImplementation(async (args: never) => {
        reached = true;
        await held;
        return before(args);
      });
      const req = request({ host: "127.0.0.1", port, path, headers });
      req.on("error", () => {});
      req.end();
      await vi.waitFor(() => expect(reached).toBe(true));
      req.destroy();
      await settle();
      release();
      await settle();
      db.teamMember.findUnique.mockImplementation(before);
    }

    it.each([["header"], ["ticket"]])("subscribes nothing and keeps no slot (%s auth)", async (auth) => {
      for (let round = 0; round < 3; round++) {
        let path = "/api/v1/stream/logs?teamId=t1";
        let headers: Record<string, string> = { Authorization: "Bearer sess_a" };
        if (auth === "ticket") {
          const res = await fetch(`http://127.0.0.1:${port}/api/v1/stream/ticket`, {
            method: "POST",
            headers: { Authorization: "Bearer sess_a", "Content-Type": "application/json" },
            body: JSON.stringify({ teamId: "t1" }),
          });
          path += `&ticket=${encodeURIComponent(((await res.json()) as { ticket: string }).ticket)}`;
          headers = {};
        }
        await abortWhileHeld(path, headers);
        expect(gauge.open).toBe(0);
        expect(events.listenerCount("log:new")).toBe(0);
      }

      for (let i = 0; i < 3; i++) expect((await keep(byHeader("sess_a"))).status).toBe(200);
      expect((await byHeader("sess_a")).status).toBe(429);
    });
  });
});
