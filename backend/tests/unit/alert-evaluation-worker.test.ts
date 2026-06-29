import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mocks — vi.hoisted() ensures these variables are available inside vi.mock()
// factory closures even after vi.mock() is hoisted above imports.
// ---------------------------------------------------------------------------

const {
  mockAlertRuleFindMany,
  mockMaintenanceWindowFindFirst,
  mockAlertIncidentFindFirst,
  mockAlertIncidentCreate,
  mockClickhouseQuery,
  mockMetricsEvaluationsInc,
  mockMetricsIncidentsInc,
  mockDispatch,
} = vi.hoisted(() => ({
  mockAlertRuleFindMany: vi.fn(),
  mockMaintenanceWindowFindFirst: vi.fn(),
  mockAlertIncidentFindFirst: vi.fn(),
  mockAlertIncidentCreate: vi.fn(),
  mockClickhouseQuery: vi.fn(),
  mockMetricsEvaluationsInc: vi.fn(),
  mockMetricsIncidentsInc: vi.fn(),
  mockDispatch: vi.fn(),
}));

vi.mock("../../src/repositories/prisma.js", () => ({
  prisma: {
    alertRule: { findMany: mockAlertRuleFindMany },
    maintenanceWindow: { findFirst: mockMaintenanceWindowFindFirst },
    alertIncident: {
      findFirst: mockAlertIncidentFindFirst,
      create: mockAlertIncidentCreate,
    },
  },
}));

vi.mock("../../src/repositories/clickhouse.js", () => ({
  clickhouse: { query: mockClickhouseQuery },
}));

// Prevent prom-client duplicate-registration errors: mock the metrics module
// so no real Counter/Histogram/Registry is created during the test run.
vi.mock("../../src/metrics/index.js", () => ({
  alertEvaluationsTotal: { inc: mockMetricsEvaluationsInc },
  alertIncidentsCreatedTotal: { inc: mockMetricsIncidentsInc },
}));

// Use class-form so vi.resetAllMocks() does not clear the constructor mock implementation
vi.mock("../../src/services/notification/notification-dispatcher.js", () => ({
  NotificationDispatcher: class {
    dispatch = mockDispatch;
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

import { AlertEvaluationWorker } from "../../src/services/alert/alert-evaluation-worker.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Access private evaluate() method in tests without production-code changes
type WorkerPrivate = {
  evaluate(): Promise<void>;
  running: boolean;
  timer: ReturnType<typeof setInterval> | null;
};

function privateWorker(w: AlertEvaluationWorker) {
  return w as unknown as WorkerPrivate;
}

function makeRule(overrides: Partial<{
  id: string;
  teamId: string;
  query: string;
  condition: string;
  threshold: number;
  windowMinutes: number;
  muteUntil: Date | null;
  enabled: boolean;
}> = {}) {
  return {
    id: "rule-1",
    teamId: "team-1",
    query: "error",
    condition: "GREATER_THAN",
    threshold: 10,
    windowMinutes: 5,
    muteUntil: null,
    enabled: true,
    ...overrides,
  };
}

/** Convenience: set up clickhouse to return a given count value */
function stubClickhouseCount(count: number) {
  mockClickhouseQuery.mockResolvedValue({
    json: vi.fn().mockResolvedValue([{ cnt: String(count) }]),
  });
}

/** Convenience: set up two sequential clickhouse count responses */
function stubClickhouseCounts(current: number, previous: number) {
  mockClickhouseQuery
    .mockResolvedValueOnce({ json: vi.fn().mockResolvedValue([{ cnt: String(current) }]) })
    .mockResolvedValueOnce({ json: vi.fn().mockResolvedValue([{ cnt: String(previous) }]) });
}

const CREATED_INCIDENT = {
  id: "new-inc-1",
  ruleId: "rule-1",
  status: "OPEN",
  severity: "MEDIUM",
  message: "Alert triggered",
  createdAt: new Date("2024-01-15T10:00:00.000Z"),
};

// ---------------------------------------------------------------------------
// start() / stop()
// ---------------------------------------------------------------------------

describe("AlertEvaluationWorker — start / stop", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("start() sets the timer", () => {
    mockAlertRuleFindMany.mockResolvedValue([]);
    const worker = new AlertEvaluationWorker(60_000);
    worker.start();
    expect(privateWorker(worker).timer).not.toBeNull();
    worker.stop();
  });

  it("start() triggers an immediate evaluation (prisma.alertRule.findMany is called)", async () => {
    mockAlertRuleFindMany.mockResolvedValue([]);
    const worker = new AlertEvaluationWorker(60_000);
    worker.start();
    // Stop immediately so the setInterval does not accumulate repeated firings
    // when we flush the microtask queue below.
    worker.stop();
    // Flush microtasks from the non-awaited evaluate() call (the one in start()).
    // advanceTimersByTimeAsync(0) yields to the JS microtask queue without
    // triggering any pending intervals (which are already cleared by stop()).
    await vi.advanceTimersByTimeAsync(0);
    expect(mockAlertRuleFindMany).toHaveBeenCalledTimes(1);
  });

  it("stop() clears the timer", () => {
    mockAlertRuleFindMany.mockResolvedValue([]);
    const worker = new AlertEvaluationWorker(60_000);
    worker.start();
    worker.stop();
    expect(privateWorker(worker).timer).toBeNull();
  });

  it("does not evaluate again after stop()", async () => {
    mockAlertRuleFindMany.mockResolvedValue([]);
    const worker = new AlertEvaluationWorker(100);
    worker.start();
    // Flush only the immediate evaluate() microtasks (not the interval)
    await vi.advanceTimersByTimeAsync(0);
    worker.stop();

    // Record calls so far, then advance well past the interval window
    const callsAfterStop = mockAlertRuleFindMany.mock.calls.length;
    await vi.advanceTimersByTimeAsync(500);

    // No additional evaluations after stop
    expect(mockAlertRuleFindMany).toHaveBeenCalledTimes(callsAfterStop);
  });

  it("calling start() twice does not create a second timer", () => {
    mockAlertRuleFindMany.mockResolvedValue([]);
    const worker = new AlertEvaluationWorker(60_000);
    worker.start();
    const firstTimer = privateWorker(worker).timer;
    worker.start();
    expect(privateWorker(worker).timer).toBe(firstTimer);
    worker.stop();
  });
});

// ---------------------------------------------------------------------------
// Mute window
// ---------------------------------------------------------------------------

describe("AlertEvaluationWorker — mute window skip", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("skips a rule whose muteUntil is in the future", async () => {
    const mutedRule = makeRule({ muteUntil: new Date(Date.now() + 3_600_000) });
    mockAlertRuleFindMany.mockResolvedValue([mutedRule]);

    const worker = new AlertEvaluationWorker();
    await privateWorker(worker).evaluate();

    // Skipped before maintenance-window check
    expect(mockMaintenanceWindowFindFirst).not.toHaveBeenCalled();
    expect(mockAlertIncidentCreate).not.toHaveBeenCalled();
  });

  it("does NOT skip a rule whose muteUntil is in the past", async () => {
    const rule = makeRule({ muteUntil: new Date(Date.now() - 1000) });
    mockAlertRuleFindMany.mockResolvedValue([rule]);
    mockMaintenanceWindowFindFirst.mockResolvedValue(null);
    mockAlertIncidentFindFirst.mockResolvedValue(null);
    stubClickhouseCount(5); // below threshold of 10 → not triggered

    const worker = new AlertEvaluationWorker();
    await privateWorker(worker).evaluate();

    // Past muteUntil is treated as "not muted" — continues to maintenance check
    expect(mockMaintenanceWindowFindFirst).toHaveBeenCalledOnce();
  });

  it("does NOT skip a rule with muteUntil = null", async () => {
    mockAlertRuleFindMany.mockResolvedValue([makeRule({ muteUntil: null })]);
    mockMaintenanceWindowFindFirst.mockResolvedValue(null);
    mockAlertIncidentFindFirst.mockResolvedValue(null);
    stubClickhouseCount(5);

    const worker = new AlertEvaluationWorker();
    await privateWorker(worker).evaluate();

    expect(mockMaintenanceWindowFindFirst).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// Maintenance window
// ---------------------------------------------------------------------------

describe("AlertEvaluationWorker — maintenance window skip", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("skips evaluation when an active maintenance window exists for the team", async () => {
    mockAlertRuleFindMany.mockResolvedValue([makeRule()]);
    mockMaintenanceWindowFindFirst.mockResolvedValue({
      id: "mw-1",
      teamId: "team-1",
      startsAt: new Date(Date.now() - 3_600_000),
      endsAt: new Date(Date.now() + 3_600_000),
    });

    const worker = new AlertEvaluationWorker();
    await privateWorker(worker).evaluate();

    expect(mockAlertIncidentFindFirst).not.toHaveBeenCalled();
    expect(mockAlertIncidentCreate).not.toHaveBeenCalled();
  });

  it("queries the maintenance window for the correct team", async () => {
    mockAlertRuleFindMany.mockResolvedValue([makeRule({ teamId: "team-xyz" })]);
    mockMaintenanceWindowFindFirst.mockResolvedValue(null);
    mockAlertIncidentFindFirst.mockResolvedValue(null);
    stubClickhouseCount(0);

    const worker = new AlertEvaluationWorker();
    await privateWorker(worker).evaluate();

    expect(mockMaintenanceWindowFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ teamId: "team-xyz" }) }),
    );
  });

  it("continues evaluation when no maintenance window is active", async () => {
    mockAlertRuleFindMany.mockResolvedValue([makeRule()]);
    mockMaintenanceWindowFindFirst.mockResolvedValue(null);
    mockAlertIncidentFindFirst.mockResolvedValue(null);
    stubClickhouseCount(5); // below threshold

    const worker = new AlertEvaluationWorker();
    await privateWorker(worker).evaluate();

    // Reached the dedup check
    expect(mockAlertIncidentFindFirst).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// Open-incident deduplication
// ---------------------------------------------------------------------------

describe("AlertEvaluationWorker — open incident deduplication", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does not create a new incident when one is already OPEN", async () => {
    mockAlertRuleFindMany.mockResolvedValue([makeRule()]);
    mockMaintenanceWindowFindFirst.mockResolvedValue(null);
    mockAlertIncidentFindFirst.mockResolvedValue({ id: "existing-inc", status: "OPEN" });

    const worker = new AlertEvaluationWorker();
    await privateWorker(worker).evaluate();

    expect(mockAlertIncidentCreate).not.toHaveBeenCalled();
    // clickhouse should not even be queried once dedup fires
    expect(mockClickhouseQuery).not.toHaveBeenCalled();
  });

  it("queries for the correct ruleId in the dedup check", async () => {
    mockAlertRuleFindMany.mockResolvedValue([makeRule({ id: "my-rule" })]);
    mockMaintenanceWindowFindFirst.mockResolvedValue(null);
    mockAlertIncidentFindFirst.mockResolvedValue(null);
    stubClickhouseCount(0);

    const worker = new AlertEvaluationWorker();
    await privateWorker(worker).evaluate();

    expect(mockAlertIncidentFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { ruleId: "my-rule", status: "OPEN" } }),
    );
  });

  it("creates a new incident when no open incident exists", async () => {
    mockAlertRuleFindMany.mockResolvedValue([makeRule({ threshold: 5 })]);
    mockMaintenanceWindowFindFirst.mockResolvedValue(null);
    mockAlertIncidentFindFirst.mockResolvedValue(null); // no open incident
    stubClickhouseCount(10); // 10 > 5 → GREATER_THAN triggered
    mockAlertIncidentCreate.mockResolvedValue(CREATED_INCIDENT);
    mockDispatch.mockResolvedValue(undefined);

    const worker = new AlertEvaluationWorker();
    await privateWorker(worker).evaluate();

    expect(mockAlertIncidentCreate).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// Condition evaluation
// ---------------------------------------------------------------------------

describe("AlertEvaluationWorker — GREATER_THAN condition", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMaintenanceWindowFindFirst.mockResolvedValue(null);
    mockAlertIncidentFindFirst.mockResolvedValue(null);
    mockAlertIncidentCreate.mockResolvedValue(CREATED_INCIDENT);
    mockDispatch.mockResolvedValue(undefined);
  });

  it("triggers when currentCount > threshold", async () => {
    mockAlertRuleFindMany.mockResolvedValue([makeRule({ condition: "GREATER_THAN", threshold: 5 })]);
    stubClickhouseCount(6);

    const worker = new AlertEvaluationWorker();
    await privateWorker(worker).evaluate();

    expect(mockAlertIncidentCreate).toHaveBeenCalledOnce();
  });

  it("does NOT trigger when currentCount === threshold", async () => {
    mockAlertRuleFindMany.mockResolvedValue([makeRule({ condition: "GREATER_THAN", threshold: 5 })]);
    stubClickhouseCount(5);

    const worker = new AlertEvaluationWorker();
    await privateWorker(worker).evaluate();

    expect(mockAlertIncidentCreate).not.toHaveBeenCalled();
  });

  it("does NOT trigger when currentCount < threshold", async () => {
    mockAlertRuleFindMany.mockResolvedValue([makeRule({ condition: "GREATER_THAN", threshold: 5 })]);
    stubClickhouseCount(4);

    const worker = new AlertEvaluationWorker();
    await privateWorker(worker).evaluate();

    expect(mockAlertIncidentCreate).not.toHaveBeenCalled();
  });
});

describe("AlertEvaluationWorker — LESS_THAN condition", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMaintenanceWindowFindFirst.mockResolvedValue(null);
    mockAlertIncidentFindFirst.mockResolvedValue(null);
    mockAlertIncidentCreate.mockResolvedValue(CREATED_INCIDENT);
    mockDispatch.mockResolvedValue(undefined);
  });

  it("triggers when currentCount < threshold", async () => {
    mockAlertRuleFindMany.mockResolvedValue([makeRule({ condition: "LESS_THAN", threshold: 5 })]);
    stubClickhouseCount(4);

    const worker = new AlertEvaluationWorker();
    await privateWorker(worker).evaluate();

    expect(mockAlertIncidentCreate).toHaveBeenCalledOnce();
  });

  it("does NOT trigger when currentCount === threshold", async () => {
    mockAlertRuleFindMany.mockResolvedValue([makeRule({ condition: "LESS_THAN", threshold: 5 })]);
    stubClickhouseCount(5);

    const worker = new AlertEvaluationWorker();
    await privateWorker(worker).evaluate();

    expect(mockAlertIncidentCreate).not.toHaveBeenCalled();
  });

  it("does NOT trigger when currentCount > threshold", async () => {
    mockAlertRuleFindMany.mockResolvedValue([makeRule({ condition: "LESS_THAN", threshold: 5 })]);
    stubClickhouseCount(6);

    const worker = new AlertEvaluationWorker();
    await privateWorker(worker).evaluate();

    expect(mockAlertIncidentCreate).not.toHaveBeenCalled();
  });
});

describe("AlertEvaluationWorker — EQUALS condition", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMaintenanceWindowFindFirst.mockResolvedValue(null);
    mockAlertIncidentFindFirst.mockResolvedValue(null);
    mockAlertIncidentCreate.mockResolvedValue(CREATED_INCIDENT);
    mockDispatch.mockResolvedValue(undefined);
  });

  it("triggers when currentCount === threshold", async () => {
    mockAlertRuleFindMany.mockResolvedValue([makeRule({ condition: "EQUALS", threshold: 7 })]);
    stubClickhouseCount(7);

    const worker = new AlertEvaluationWorker();
    await privateWorker(worker).evaluate();

    expect(mockAlertIncidentCreate).toHaveBeenCalledOnce();
  });

  it("does NOT trigger when currentCount !== threshold", async () => {
    mockAlertRuleFindMany.mockResolvedValue([makeRule({ condition: "EQUALS", threshold: 7 })]);
    stubClickhouseCount(8);

    const worker = new AlertEvaluationWorker();
    await privateWorker(worker).evaluate();

    expect(mockAlertIncidentCreate).not.toHaveBeenCalled();
  });
});

describe("AlertEvaluationWorker — CHANGES_BY condition", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMaintenanceWindowFindFirst.mockResolvedValue(null);
    mockAlertIncidentFindFirst.mockResolvedValue(null);
    mockAlertIncidentCreate.mockResolvedValue(CREATED_INCIDENT);
    mockDispatch.mockResolvedValue(undefined);
  });

  it("makes a SECOND clickhouse query for the previous window", async () => {
    mockAlertRuleFindMany.mockResolvedValue([
      makeRule({ condition: "CHANGES_BY", threshold: 5 }),
    ]);
    stubClickhouseCounts(15, 5); // current=15, previous=5, delta=10 >= 5

    const worker = new AlertEvaluationWorker();
    await privateWorker(worker).evaluate();

    expect(mockClickhouseQuery).toHaveBeenCalledTimes(2);
  });

  it("triggers when absolute delta >= threshold", async () => {
    mockAlertRuleFindMany.mockResolvedValue([
      makeRule({ condition: "CHANGES_BY", threshold: 5 }),
    ]);
    stubClickhouseCounts(15, 5); // delta = |15 - 5| = 10 >= 5

    const worker = new AlertEvaluationWorker();
    await privateWorker(worker).evaluate();

    expect(mockAlertIncidentCreate).toHaveBeenCalledOnce();
  });

  it("triggers when delta is a negative change (previous > current)", async () => {
    mockAlertRuleFindMany.mockResolvedValue([
      makeRule({ condition: "CHANGES_BY", threshold: 5 }),
    ]);
    stubClickhouseCounts(3, 15); // delta = |3 - 15| = 12 >= 5

    const worker = new AlertEvaluationWorker();
    await privateWorker(worker).evaluate();

    expect(mockAlertIncidentCreate).toHaveBeenCalledOnce();
  });

  it("does NOT trigger when absolute delta < threshold", async () => {
    mockAlertRuleFindMany.mockResolvedValue([
      makeRule({ condition: "CHANGES_BY", threshold: 10 }),
    ]);
    stubClickhouseCounts(13, 10); // delta = |13 - 10| = 3 < 10

    const worker = new AlertEvaluationWorker();
    await privateWorker(worker).evaluate();

    expect(mockAlertIncidentCreate).not.toHaveBeenCalled();
  });

  it("triggers when delta exactly equals threshold", async () => {
    mockAlertRuleFindMany.mockResolvedValue([
      makeRule({ condition: "CHANGES_BY", threshold: 5 }),
    ]);
    stubClickhouseCounts(15, 10); // delta = 5 >= 5

    const worker = new AlertEvaluationWorker();
    await privateWorker(worker).evaluate();

    expect(mockAlertIncidentCreate).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// Incident creation + dispatcher
// ---------------------------------------------------------------------------

describe("AlertEvaluationWorker — incident creation and notification dispatch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMaintenanceWindowFindFirst.mockResolvedValue(null);
    mockAlertIncidentFindFirst.mockResolvedValue(null);
    mockAlertIncidentCreate.mockResolvedValue(CREATED_INCIDENT);
    mockDispatch.mockResolvedValue(undefined);
  });

  it("creates an incident with status OPEN and severity MEDIUM when triggered", async () => {
    mockAlertRuleFindMany.mockResolvedValue([makeRule({ threshold: 5 })]);
    stubClickhouseCount(10); // 10 > 5 → triggered

    const worker = new AlertEvaluationWorker();
    await privateWorker(worker).evaluate();

    expect(mockAlertIncidentCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "OPEN", severity: "MEDIUM" }),
      }),
    );
  });

  it("includes the rule query and condition in the incident message", async () => {
    mockAlertRuleFindMany.mockResolvedValue([
      makeRule({ query: "payment_error", condition: "GREATER_THAN", threshold: 5 }),
    ]);
    stubClickhouseCount(10);

    const worker = new AlertEvaluationWorker();
    await privateWorker(worker).evaluate();

    const createCall = mockAlertIncidentCreate.mock.calls[0][0] as {
      data: { message: string };
    };
    expect(createCall.data.message).toContain("payment_error");
    expect(createCall.data.message).toContain("GREATER_THAN");
  });

  it("calls dispatcher.dispatch after creating the incident", async () => {
    mockAlertRuleFindMany.mockResolvedValue([makeRule({ threshold: 5 })]);
    stubClickhouseCount(10);

    const worker = new AlertEvaluationWorker();
    await privateWorker(worker).evaluate();
    // dispatch is fire-and-forget; flush the microtask queue
    await Promise.resolve();

    expect(mockDispatch).toHaveBeenCalledOnce();
  });

  it("dispatches with the correct incident fields", async () => {
    mockAlertRuleFindMany.mockResolvedValue([makeRule({ id: "rule-x", teamId: "team-x", threshold: 5 })]);
    stubClickhouseCount(10);

    const worker = new AlertEvaluationWorker();
    await privateWorker(worker).evaluate();
    await Promise.resolve();

    expect(mockDispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        id: CREATED_INCIDENT.id,
        ruleId: "rule-x",
        teamId: "team-x",
        status: "OPEN",
        severity: "MEDIUM",
      }),
    );
  });

  it("increments alertEvaluationsTotal with status 'ok' on success", async () => {
    mockAlertRuleFindMany.mockResolvedValue([makeRule({ threshold: 5 })]);
    stubClickhouseCount(10);

    const worker = new AlertEvaluationWorker();
    await privateWorker(worker).evaluate();

    expect(mockMetricsEvaluationsInc).toHaveBeenCalledWith({ status: "ok" });
  });

  it("increments alertIncidentsCreatedTotal when an incident is created", async () => {
    mockAlertRuleFindMany.mockResolvedValue([makeRule({ threshold: 5 })]);
    stubClickhouseCount(10);

    const worker = new AlertEvaluationWorker();
    await privateWorker(worker).evaluate();

    expect(mockMetricsIncidentsInc).toHaveBeenCalledOnce();
  });

  it("does NOT call dispatcher.dispatch when the rule is not triggered", async () => {
    mockAlertRuleFindMany.mockResolvedValue([makeRule({ threshold: 100 })]);
    stubClickhouseCount(5); // 5 < 100, not triggered

    const worker = new AlertEvaluationWorker();
    await privateWorker(worker).evaluate();
    await Promise.resolve();

    expect(mockDispatch).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Concurrency guard (this.running)
// ---------------------------------------------------------------------------

describe("AlertEvaluationWorker — concurrency guard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("prevents a second evaluate() from running while the first is in-flight", async () => {
    // Hold the first evaluate() at the prisma.alertRule.findMany call
    let resolveFindMany!: (v: unknown[]) => void;
    const blocked = new Promise<unknown[]>((resolve) => {
      resolveFindMany = resolve;
    });
    mockAlertRuleFindMany.mockReturnValue(blocked);

    const worker = new AlertEvaluationWorker();
    const pw = privateWorker(worker);

    // Start first evaluation — suspends at findMany
    const firstEval = pw.evaluate();
    // running is set synchronously before the first await
    expect(pw.running).toBe(true);

    // Second call should return immediately (guard fires)
    await pw.evaluate();

    // Only one findMany call so far (second evaluate bailed out)
    expect(mockAlertRuleFindMany).toHaveBeenCalledTimes(1);

    // Let the first evaluation complete
    resolveFindMany([]);
    await firstEval;

    // running is reset in the finally block
    expect(pw.running).toBe(false);
  });

  it("allows a new evaluate() after the previous one completes", async () => {
    mockAlertRuleFindMany.mockResolvedValue([]);

    const worker = new AlertEvaluationWorker();
    const pw = privateWorker(worker);

    await pw.evaluate();
    expect(pw.running).toBe(false);

    // Second call should proceed normally
    await pw.evaluate();
    expect(mockAlertRuleFindMany).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// Error handling
// ---------------------------------------------------------------------------

describe("AlertEvaluationWorker — rule-level error handling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("increments alertEvaluationsTotal with status 'error' when rule evaluation fails", async () => {
    mockAlertRuleFindMany.mockResolvedValue([makeRule()]);
    mockMaintenanceWindowFindFirst.mockResolvedValue(null);
    mockAlertIncidentFindFirst.mockResolvedValue(null);
    // Cause clickhouse to throw
    mockClickhouseQuery.mockRejectedValue(new Error("ClickHouse connection failed"));

    const worker = new AlertEvaluationWorker();
    await privateWorker(worker).evaluate();

    expect(mockMetricsEvaluationsInc).toHaveBeenCalledWith({ status: "error" });
  });

  it("continues evaluating remaining rules when one rule throws", async () => {
    const rule1 = makeRule({ id: "rule-1" });
    const rule2 = makeRule({ id: "rule-2" });
    mockAlertRuleFindMany.mockResolvedValue([rule1, rule2]);
    mockMaintenanceWindowFindFirst.mockResolvedValue(null);
    mockAlertIncidentFindFirst.mockResolvedValue(null);
    // First rule throws, second rule returns 0 (not triggered)
    mockClickhouseQuery
      .mockRejectedValueOnce(new Error("rule1 fails"))
      .mockResolvedValueOnce({ json: vi.fn().mockResolvedValue([{ cnt: "0" }]) });

    const worker = new AlertEvaluationWorker();
    await privateWorker(worker).evaluate();

    // rule1 errored → error metric; rule2 succeeded → ok metric
    expect(mockMetricsEvaluationsInc).toHaveBeenCalledWith({ status: "error" });
    expect(mockMetricsEvaluationsInc).toHaveBeenCalledWith({ status: "ok" });
  });
});
