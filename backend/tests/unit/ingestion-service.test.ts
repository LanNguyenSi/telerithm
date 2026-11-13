import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mocks — must appear before any import that resolves the mocked modules
// ---------------------------------------------------------------------------

const {
  mockFindSourceById,
  mockLogRepoInsert,
  mockCacheInvalidate,
  mockTrackError,
  mockIngestBatchInc,
  mockIngestLogsInc,
} = vi.hoisted(() => ({
  mockFindSourceById: vi.fn(),
  mockLogRepoInsert: vi.fn(),
  mockCacheInvalidate: vi.fn(),
  mockTrackError: vi.fn(),
  mockIngestBatchInc: vi.fn(),
  mockIngestLogsInc: vi.fn(),
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

vi.mock("../../src/repositories/log-repository.js", () => ({
  LogRepository: vi.fn().mockImplementation(function () {
    return { insert: mockLogRepoInsert };
  }),
}));

vi.mock("../../src/services/team/team-service.js", () => ({
  TeamService: vi.fn().mockImplementation(function () {
    return { findSourceById: mockFindSourceById };
  }),
}));

vi.mock("../../src/services/issue/issue-service.js", () => ({
  IssueService: vi.fn().mockImplementation(function () {
    return { trackError: mockTrackError };
  }),
}));

vi.mock("../../src/cache/cache-service.js", () => ({
  cache: { invalidate: mockCacheInvalidate },
}));

vi.mock("../../src/metrics/index.js", () => ({
  ingestBatchTotal: { inc: mockIngestBatchInc },
  ingestLogsTotal: { inc: mockIngestLogsInc },
}));

import { IngestionService, IngestBatchTooLargeError } from "../../src/ingestion/ingestion-service.js";
import { MAX_INGEST_BATCH } from "../../src/validation/schemas.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SOURCE_ID = "src-1";
const TEAM_ID = "team-1";

function makeSource(overrides: Record<string, unknown> = {}) {
  return {
    id: SOURCE_ID,
    teamId: TEAM_ID,
    name: "web-app",
    type: "HTTP",
    config: {},
    retentionDays: 7,
    apiKey: "lf_abc",
    createdAt: new Date("2024-01-01T00:00:00.000Z"),
    ...overrides,
  };
}

// Let the detached error-tracking chain run to completion (macrotask flush).
function flushChain(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("IngestionService.ingest", () => {
  let service: IngestionService;

  beforeEach(() => {
    vi.clearAllMocks();
    mockTrackError.mockResolvedValue(undefined);
    service = new IngestionService();
  });

  it("accepts a structured log object, writes it, invalidates cache, and emits log:new", async () => {
    mockFindSourceById.mockResolvedValue(makeSource());
    mockLogRepoInsert.mockResolvedValue(undefined);
    mockCacheInvalidate.mockResolvedValue(undefined);

    const emitted: unknown[] = [];
    service.events.on("log:new", (entry) => emitted.push(entry));

    const result = await service.ingest(SOURCE_ID, {
      logs: [{ level: "warn", message: "disk usage high" }],
    });

    expect(mockFindSourceById).toHaveBeenCalledWith(SOURCE_ID);
    expect(mockLogRepoInsert).toHaveBeenCalledWith([
      expect.objectContaining({
        teamId: TEAM_ID,
        sourceId: SOURCE_ID,
        level: "warn",
        service: "web-app",
        host: "unknown",
        message: "disk usage high",
        fields: {},
      }),
    ]);
    expect(mockCacheInvalidate).toHaveBeenCalledWith(`dashboard:overview:${TEAM_ID}`);
    expect(emitted).toHaveLength(1);
    // level "warn" must NOT be tracked as an issue
    expect(mockTrackError).not.toHaveBeenCalled();

    expect(result.accepted).toBe(1);
    expect(result.rejected).toBe(0);
    expect(result.errors).toEqual([]);
    expect(typeof result.batchId).toBe("string");
    expect(mockIngestBatchInc).toHaveBeenCalledWith({ status: "ok" });
    expect(mockIngestLogsInc).toHaveBeenCalledWith(1);
  });

  it("tracks an issue (fire-and-forget) when an accepted entry has level error or fatal", async () => {
    mockFindSourceById.mockResolvedValue(makeSource());
    mockLogRepoInsert.mockResolvedValue(undefined);
    mockCacheInvalidate.mockResolvedValue(undefined);

    await service.ingest(SOURCE_ID, {
      logs: [
        { level: "error", message: "boom" },
        { level: "fatal", message: "oom" },
      ],
    });
    await flushChain();

    expect(mockTrackError).toHaveBeenCalledTimes(2);
    expect(mockTrackError).toHaveBeenCalledWith(TEAM_ID, "error", "web-app", "boom");
    expect(mockTrackError).toHaveBeenCalledWith(TEAM_ID, "fatal", "web-app", "oom");
  });

  it("runs at most one trackError at a time for a batch of several error entries", async () => {
    mockFindSourceById.mockResolvedValue(makeSource());
    mockLogRepoInsert.mockResolvedValue(undefined);
    mockCacheInvalidate.mockResolvedValue(undefined);

    let inFlight = 0;
    let maxInFlight = 0;
    const order: string[] = [];
    mockTrackError.mockImplementation(async (_teamId: string, _level: string, _svc: string, msg: string) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      order.push(msg);
      // resolve on a later macrotask so parallel fan-out would overlap
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight -= 1;
    });

    await service.ingest(SOURCE_ID, {
      logs: [
        { level: "error", message: "e1" },
        { level: "error", message: "e2" },
        { level: "fatal", message: "e3" },
        { level: "warn", message: "ignored" },
        { level: "error", message: "e4" },
      ],
    });

    // ingest must not wait for the detached chain
    expect(order.length).toBeLessThanOrEqual(1);

    await vi.waitFor(() => expect(mockTrackError).toHaveBeenCalledTimes(4));
    expect(maxInFlight).toBe(1);
    expect(order).toEqual(["e1", "e2", "e3", "e4"]);
  });

  it("returns before the error-tracking chain finishes", async () => {
    mockFindSourceById.mockResolvedValue(makeSource());
    mockLogRepoInsert.mockResolvedValue(undefined);
    mockCacheInvalidate.mockResolvedValue(undefined);

    let releaseChain!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseChain = resolve;
    });
    mockTrackError.mockImplementation(async () => {
      await gate;
    });

    const result = await service.ingest(SOURCE_ID, {
      logs: [
        { level: "error", message: "e1" },
        { level: "error", message: "e2" },
      ],
    });

    // The call resolved while the tracking chain is still blocked.
    expect(result).toMatchObject({ accepted: 2 });
    expect(mockTrackError).toHaveBeenCalledTimes(1);

    releaseChain();
    await vi.waitFor(() => expect(mockTrackError).toHaveBeenCalledTimes(2));
  });

  it("keeps calling trackError after one rejects", async () => {
    mockFindSourceById.mockResolvedValue(makeSource());
    mockLogRepoInsert.mockResolvedValue(undefined);
    mockCacheInvalidate.mockResolvedValue(undefined);

    mockTrackError.mockImplementation(async (_teamId: string, _level: string, _svc: string, msg: string) => {
      if (msg === "bad") throw new Error("issue write failed");
    });

    await service.ingest(SOURCE_ID, {
      logs: [
        { level: "error", message: "ok1" },
        { level: "error", message: "bad" },
        { level: "error", message: "ok2" },
      ],
    });

    await vi.waitFor(() => expect(mockTrackError).toHaveBeenCalledTimes(3));
    expect(mockTrackError).toHaveBeenCalledWith(TEAM_ID, "error", "web-app", "ok2");
  });

  it("does not let a rejected trackError promise reject the ingest call", async () => {
    mockFindSourceById.mockResolvedValue(makeSource());
    mockLogRepoInsert.mockResolvedValue(undefined);
    mockCacheInvalidate.mockResolvedValue(undefined);
    mockTrackError.mockRejectedValue(new Error("issue write failed"));

    await expect(
      service.ingest(SOURCE_ID, { logs: [{ level: "error", message: "boom" }] }),
    ).resolves.toMatchObject({ accepted: 1 });
  });

  it("preserves an explicit batchId when provided", async () => {
    mockFindSourceById.mockResolvedValue(makeSource());
    mockLogRepoInsert.mockResolvedValue(undefined);
    mockCacheInvalidate.mockResolvedValue(undefined);

    const result = await service.ingest(SOURCE_ID, {
      logs: [{ message: "hi" }],
      batchId: "batch-xyz",
    });

    expect(result.batchId).toBe("batch-xyz");
  });

  it("throws and never writes when the source does not exist", async () => {
    mockFindSourceById.mockResolvedValue(null);

    await expect(service.ingest("missing-source", { logs: [{ message: "hi" }] })).rejects.toThrow(
      "Source not found",
    );

    expect(mockLogRepoInsert).not.toHaveBeenCalled();
    expect(mockCacheInvalidate).not.toHaveBeenCalled();
    expect(mockIngestBatchInc).not.toHaveBeenCalled();
  });

  it("collects a per-item error and continues when a raw string log entry fails to parse, without dropping valid entries", async () => {
    mockFindSourceById.mockResolvedValue(makeSource());
    mockLogRepoInsert.mockResolvedValue(undefined);
    mockCacheInvalidate.mockResolvedValue(undefined);

    const result = await service.ingest(SOURCE_ID, {
      logs: ["{ not valid json", { message: "still ok" }],
    });

    expect(result.accepted).toBe(1);
    expect(result.rejected).toBe(1);
    expect(result.errors).toEqual([{ index: 0, error: expect.any(String) }]);
    // the valid entry must still be written
    expect(mockLogRepoInsert).toHaveBeenCalledWith([
      expect.objectContaining({ message: "still ok" }),
    ]);
    expect(mockIngestBatchInc).toHaveBeenCalledWith({ status: "partial" });
    expect(mockIngestLogsInc).toHaveBeenCalledWith(1);
  });

  it("does not write, invalidate cache, or emit when every entry is rejected", async () => {
    mockFindSourceById.mockResolvedValue(makeSource());

    const result = await service.ingest(SOURCE_ID, {
      logs: ["{ still not valid json"],
    });

    expect(result.accepted).toBe(0);
    expect(result.rejected).toBe(1);
    expect(mockLogRepoInsert).not.toHaveBeenCalled();
    expect(mockCacheInvalidate).not.toHaveBeenCalled();
    expect(mockIngestBatchInc).toHaveBeenCalledWith({ status: "partial" });
    expect(mockIngestLogsInc).toHaveBeenCalledWith(0);
  });

  it("rejects a request whose single string element parses into more than MAX_INGEST_BATCH entries, writing and tracking nothing", async () => {
    mockFindSourceById.mockResolvedValue(makeSource());
    mockLogRepoInsert.mockResolvedValue(undefined);
    // level error on every entry: without the parsed-count check the
    // request would also fan out MAX_INGEST_BATCH + 1 trackError calls.
    const expanded = Array.from({ length: MAX_INGEST_BATCH + 1 }, (_, i) => ({
      level: "error",
      message: `boom ${i}`,
    }));

    await expect(service.ingest(SOURCE_ID, { logs: [JSON.stringify(expanded)] })).rejects.toThrow(
      IngestBatchTooLargeError,
    );
    await expect(
      service.ingest(SOURCE_ID, { logs: [JSON.stringify(expanded)] }),
    ).rejects.toThrow(String(MAX_INGEST_BATCH));

    await flushChain();
    expect(mockLogRepoInsert).not.toHaveBeenCalled();
    expect(mockCacheInvalidate).not.toHaveBeenCalled();
    expect(mockTrackError).not.toHaveBeenCalled();
    expect(mockIngestBatchInc).not.toHaveBeenCalled();
    expect(mockIngestLogsInc).not.toHaveBeenCalled();
  });

  it("accepts a request that parses into exactly MAX_INGEST_BATCH entries", async () => {
    mockFindSourceById.mockResolvedValue(makeSource());
    mockLogRepoInsert.mockResolvedValue(undefined);
    mockCacheInvalidate.mockResolvedValue(undefined);
    const expanded = Array.from({ length: MAX_INGEST_BATCH }, (_, i) => ({ message: `line ${i}` }));

    const result = await service.ingest(SOURCE_ID, { logs: [JSON.stringify(expanded)] });

    expect(result.accepted).toBe(MAX_INGEST_BATCH);
    expect(mockLogRepoInsert).toHaveBeenCalledOnce();
    expect(mockLogRepoInsert.mock.calls[0][0]).toHaveLength(MAX_INGEST_BATCH);
    expect(mockIngestLogsInc).toHaveBeenCalledWith(MAX_INGEST_BATCH);
  });
});
