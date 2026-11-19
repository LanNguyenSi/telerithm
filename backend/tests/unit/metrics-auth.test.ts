// Unit tests for the METRICS_TOKEN bearer check shared by GET /metrics
// (backend/src/app.ts) and the per-dependency detail of GET /api/v1/health
// (backend/src/api/rest/router.ts, hasValidMetricsToken). The end-to-end
// status codes are pinned in tests/integration/api.test.ts; this file pins
// the header parsing and the comparison itself, including the shapes a
// `===`-style check gets wrong (empty bearer value, wrong scheme casing,
// prefix/suffix of the real token).
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mockConfig = vi.hoisted(() => ({
  metricsToken: undefined as string | undefined,
}));
vi.mock("../../src/config/index.js", () => ({ config: mockConfig }));
vi.mock("../../src/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), fatal: vi.fn() },
  createChildLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));
vi.mock("../../src/repositories/prisma.js", () => ({
  prisma: {},
  connectDatabase: vi.fn(),
  disconnectDatabase: vi.fn(),
}));
vi.mock("../../src/repositories/clickhouse.js", () => ({
  clickhouse: {},
  connectClickHouse: vi.fn(),
  disconnectClickHouse: vi.fn(),
}));
vi.mock("../../src/repositories/redis.js", () => ({
  redis: {},
  connectRedis: vi.fn(),
  disconnectRedis: vi.fn(),
}));

const TOKEN = "unit-metrics-token-0123456789abcdef";

describe("hasValidMetricsToken", () => {
  let hasValidMetricsToken: (authorization: string | undefined) => boolean;

  beforeAll(async () => {
    ({ hasValidMetricsToken } = await import("../../src/api/rest/router.js"));
  });

  beforeEach(() => {
    mockConfig.metricsToken = TOKEN;
  });

  it("false when METRICS_TOKEN is unset, even with a bearer header", async () => {
    mockConfig.metricsToken = undefined;
    expect(hasValidMetricsToken(`Bearer ${TOKEN}`)).toBe(false);
    expect(hasValidMetricsToken(undefined)).toBe(false);
  });

  it("false when the token is set and no header is sent", () => {
    expect(hasValidMetricsToken(undefined)).toBe(false);
    expect(hasValidMetricsToken("")).toBe(false);
  });

  it("false for a header that is not a Bearer credential", () => {
    expect(hasValidMetricsToken(`Token ${TOKEN}`)).toBe(false);
    expect(hasValidMetricsToken(`Basic ${TOKEN}`)).toBe(false);
    expect(hasValidMetricsToken(TOKEN)).toBe(false);
    expect(hasValidMetricsToken("Bearer ")).toBe(false);
  });

  it("false for a wrong token, equal length or not", () => {
    expect(hasValidMetricsToken(`Bearer ${"x".repeat(TOKEN.length)}`)).toBe(false);
    expect(hasValidMetricsToken(`Bearer ${TOKEN}0`)).toBe(false);
    expect(hasValidMetricsToken(`Bearer ${TOKEN.slice(0, -1)}`)).toBe(false);
  });

  it("true only for the exact token with the Bearer scheme, scheme casing ignored", () => {
    expect(hasValidMetricsToken(`Bearer ${TOKEN}`)).toBe(true);
    expect(hasValidMetricsToken(`bearer ${TOKEN}`)).toBe(true);
    expect(hasValidMetricsToken(`BEARER ${TOKEN}`)).toBe(true);
  });
});
