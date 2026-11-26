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
  mockMetricsPassTicksSet,
  mockDispatch,
  mockLogWarn,
  mockConfig,
} = vi.hoisted(() => ({
  mockAlertRuleFindMany: vi.fn(),
  mockMaintenanceWindowFindFirst: vi.fn(),
  mockAlertIncidentFindFirst: vi.fn(),
  mockAlertIncidentCreate: vi.fn(),
  mockClickhouseQuery: vi.fn(),
  mockMetricsEvaluationsInc: vi.fn(),
  mockMetricsIncidentsInc: vi.fn(),
  mockMetricsPassTicksSet: vi.fn(),
  mockDispatch: vi.fn(),
  mockLogWarn: vi.fn(),
  mockConfig: { alertEvalMaxRulesPerTick: 1000 },
}));

// The per-tick budget comes from config; the real module would validate env
// vars at import time. Tests set mockConfig.alertEvalMaxRulesPerTick.
vi.mock("../../src/config/index.js", () => ({ config: mockConfig }));

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
  alertEvalPassTicks: { set: mockMetricsPassTicksSet },
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
    warn: mockLogWarn,
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

import {
  ALERT_RULE_EVAL_BATCH_SIZE,
  AlertEvaluationWorker,
} from "../../src/services/alert/alert-evaluation-worker.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Access private evaluate() method in tests without production-code changes
type WorkerPrivate = {
  evaluate(): Promise<void>;
  running: boolean;
  timer: ReturnType<typeof setInterval> | null;
  cursorAfterId: string | null;
  passRulesEvaluated: number;
  passTicks: number;
};

function privateWorker(w: AlertEvaluationWorker) {
  return w as unknown as WorkerPrivate;
}

function makeRule(
  overrides: Partial<{
    id: string;
    teamId: string;
    query: string;
    condition: string;
    threshold: number;
    windowMinutes: number;
    muteUntil: Date | null;
    enabled: boolean;
  }> = {},
) {
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
    mockAlertRuleFindMany.mockResolvedValue([makeRule({ condition: "CHANGES_BY", threshold: 5 })]);
    stubClickhouseCounts(15, 5); // current=15, previous=5, delta=10 >= 5

    const worker = new AlertEvaluationWorker();
    await privateWorker(worker).evaluate();

    expect(mockClickhouseQuery).toHaveBeenCalledTimes(2);
  });

  it("triggers when absolute delta >= threshold", async () => {
    mockAlertRuleFindMany.mockResolvedValue([makeRule({ condition: "CHANGES_BY", threshold: 5 })]);
    stubClickhouseCounts(15, 5); // delta = |15 - 5| = 10 >= 5

    const worker = new AlertEvaluationWorker();
    await privateWorker(worker).evaluate();

    expect(mockAlertIncidentCreate).toHaveBeenCalledOnce();
  });

  it("triggers when delta is a negative change (previous > current)", async () => {
    mockAlertRuleFindMany.mockResolvedValue([makeRule({ condition: "CHANGES_BY", threshold: 5 })]);
    stubClickhouseCounts(3, 15); // delta = |3 - 15| = 12 >= 5

    const worker = new AlertEvaluationWorker();
    await privateWorker(worker).evaluate();

    expect(mockAlertIncidentCreate).toHaveBeenCalledOnce();
  });

  it("does NOT trigger when absolute delta < threshold", async () => {
    mockAlertRuleFindMany.mockResolvedValue([makeRule({ condition: "CHANGES_BY", threshold: 10 })]);
    stubClickhouseCounts(13, 10); // delta = |13 - 10| = 3 < 10

    const worker = new AlertEvaluationWorker();
    await privateWorker(worker).evaluate();

    expect(mockAlertIncidentCreate).not.toHaveBeenCalled();
  });

  it("triggers when delta exactly equals threshold", async () => {
    mockAlertRuleFindMany.mockResolvedValue([makeRule({ condition: "CHANGES_BY", threshold: 5 })]);
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

// ---------------------------------------------------------------------------
// ANOMALY_DETECTED (reserved, not evaluated)
// ---------------------------------------------------------------------------

describe("AlertEvaluationWorker - ANOMALY_DETECTED condition", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMaintenanceWindowFindFirst.mockResolvedValue(null);
    mockAlertIncidentFindFirst.mockResolvedValue(null);
    stubClickhouseCount(1000);
  });

  it("is skipped without querying ClickHouse and never opens an incident", async () => {
    mockAlertRuleFindMany.mockResolvedValue([makeRule({ condition: "ANOMALY_DETECTED", threshold: 1 })]);

    const worker = new AlertEvaluationWorker();
    await privateWorker(worker).evaluate();

    expect(mockClickhouseQuery).not.toHaveBeenCalled();
    expect(mockAlertIncidentCreate).not.toHaveBeenCalled();
    expect(mockDispatch).not.toHaveBeenCalled();
    expect(mockMetricsEvaluationsInc).toHaveBeenCalledWith({ status: "ok" });
    expect(mockMetricsEvaluationsInc).not.toHaveBeenCalledWith({ status: "error" });
  });

  it("reports the unsupported condition once per rule, not on every loop", async () => {
    mockAlertRuleFindMany.mockResolvedValue([
      makeRule({ id: "anomaly-1", condition: "ANOMALY_DETECTED" }),
      makeRule({ id: "anomaly-2", condition: "ANOMALY_DETECTED" }),
    ]);

    const worker = new AlertEvaluationWorker();
    await privateWorker(worker).evaluate();
    await privateWorker(worker).evaluate();

    expect(mockLogWarn).toHaveBeenCalledTimes(2);
    expect(mockLogWarn).toHaveBeenCalledWith(
      expect.objectContaining({ ruleId: "anomaly-1", condition: "ANOMALY_DETECTED" }),
      expect.stringContaining("not supported"),
    );
    expect(mockLogWarn).toHaveBeenCalledWith(
      expect.objectContaining({ ruleId: "anomaly-2" }),
      expect.stringContaining("not supported"),
    );
  });

  it("does not hold back the evaluated rules next to it", async () => {
    mockAlertRuleFindMany.mockResolvedValue([
      makeRule({ id: "anomaly", condition: "ANOMALY_DETECTED" }),
      makeRule({ id: "plain", condition: "GREATER_THAN", threshold: 5 }),
    ]);
    mockAlertIncidentCreate.mockResolvedValue(CREATED_INCIDENT);
    mockDispatch.mockResolvedValue(undefined);

    const worker = new AlertEvaluationWorker();
    await privateWorker(worker).evaluate();

    expect(mockAlertIncidentCreate).toHaveBeenCalledOnce();
    expect(mockAlertIncidentCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ ruleId: "plain" }),
    });
  });
});

// ---------------------------------------------------------------------------
// ClickHouse query parameters
// ---------------------------------------------------------------------------

describe("AlertEvaluationWorker - log count query parameters", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMaintenanceWindowFindFirst.mockResolvedValue(null);
    mockAlertIncidentFindFirst.mockResolvedValue(null);
    stubClickhouseCount(0);
  });

  it("binds the rule query as a case-insensitive substring pattern", async () => {
    mockAlertRuleFindMany.mockResolvedValue([makeRule({ query: "Payment failed" })]);

    await privateWorker(new AlertEvaluationWorker()).evaluate();

    const call = mockClickhouseQuery.mock.calls[0][0];
    expect(call.query).toContain("message ILIKE {pattern:String}");
    expect(call.query_params.pattern).toBe("%Payment failed%");
    expect(call.query_params.teamId).toBe("team-1");
  });

  it("sends the window bounds in ClickHouse's DateTime64 text form, not as ISO strings", async () => {
    mockAlertRuleFindMany.mockResolvedValue([makeRule()]);

    await privateWorker(new AlertEvaluationWorker()).evaluate();

    const { from, to } = mockClickhouseQuery.mock.calls[0][0].query_params;
    // ClickHouse rejects "2026-10-14T04:44:41.318Z" for a DateTime64(3) parameter
    expect(from).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}$/);
    expect(to).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}$/);
    expect(
      new Date(`${to.replace(" ", "T")}Z`).getTime() - new Date(`${from.replace(" ", "T")}Z`).getTime(),
    ).toBe(5 * 60_000);
  });
});

// ---------------------------------------------------------------------------
// Batched rule loading
// ---------------------------------------------------------------------------

describe("AlertEvaluationWorker: batched rule loading", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Nothing triggers: counts stay below every rule's threshold.
    mockMaintenanceWindowFindFirst.mockResolvedValue(null);
    mockAlertIncidentFindFirst.mockResolvedValue(null);
    stubClickhouseCount(0);
  });

  it("pins the batch size constant at 500", () => {
    expect(ALERT_RULE_EVAL_BATCH_SIZE).toBe(500);
  });

  function batchOf(prefix: string, offset: number, n: number) {
    return Array.from({ length: n }, (_, i) =>
      makeRule({ id: `${prefix}-${String(offset + i).padStart(4, "0")}` }),
    );
  }

  it("loads more than one batch and evaluates every rule exactly once per tick", async () => {
    const first = batchOf("r", 0, ALERT_RULE_EVAL_BATCH_SIZE);
    const second = batchOf("r", ALERT_RULE_EVAL_BATCH_SIZE, 3);
    const all = [...first, ...second];
    let calls = 0;
    mockAlertRuleFindMany.mockImplementation(async (args: { where: { id?: { gt?: string } } }) => {
      // Call bound: a page cursor that never advances would spin forever.
      calls += 1;
      if (calls > 10) throw new Error("findMany called too often: the page cursor is not advancing");
      const after = args.where.id?.gt;
      if (after === undefined) return first;
      if (after === first[first.length - 1].id) return second;
      return [];
    });

    await privateWorker(new AlertEvaluationWorker()).evaluate();

    // Two pages: full, then short.
    expect(mockAlertRuleFindMany).toHaveBeenCalledTimes(2);
    // Every rule of every batch evaluated exactly once, each counted as ok.
    expect(mockMetricsEvaluationsInc).toHaveBeenCalledTimes(all.length);
    expect(mockMetricsEvaluationsInc).toHaveBeenCalledWith({ status: "ok" });
    // The second page starts after the first page's last id, ordered, and
    // both pages carry a constant take.
    expect(mockAlertRuleFindMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: { enabled: true },
        orderBy: { id: "asc" },
        take: ALERT_RULE_EVAL_BATCH_SIZE,
      }),
    );
    expect(mockAlertRuleFindMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: { enabled: true, id: { gt: first[first.length - 1].id } },
        orderBy: { id: "asc" },
        take: ALERT_RULE_EVAL_BATCH_SIZE,
      }),
    );
  });

  it("stops paging at a short batch, asking for the rule list only once below the batch size", async () => {
    let calls = 0;
    mockAlertRuleFindMany.mockImplementation(async () => {
      // Call bound: a stop condition that never fires would spin forever.
      calls += 1;
      if (calls > 10) throw new Error("findMany called too often: paging did not stop at a short batch");
      return batchOf("r", 0, ALERT_RULE_EVAL_BATCH_SIZE - 1);
    });

    await privateWorker(new AlertEvaluationWorker()).evaluate();

    expect(mockAlertRuleFindMany).toHaveBeenCalledTimes(1);
    expect(mockMetricsEvaluationsInc).toHaveBeenCalledTimes(ALERT_RULE_EVAL_BATCH_SIZE - 1);
  });

  it("never asks findMany for more rows than the batch size", async () => {
    // Default budget (1000) above the page: every findMany take is the batch
    // size itself; the budget must not raise it.
    const first = batchOf("r", 0, ALERT_RULE_EVAL_BATCH_SIZE);
    let calls = 0;
    mockAlertRuleFindMany.mockImplementation(async () => {
      calls += 1;
      if (calls > 10) throw new Error("findMany called too often: the page cursor is not advancing");
      return calls === 1 ? first : [];
    });

    await privateWorker(new AlertEvaluationWorker()).evaluate();

    for (const call of mockAlertRuleFindMany.mock.calls) {
      expect((call[0] as { take: number }).take).toBe(ALERT_RULE_EVAL_BATCH_SIZE);
    }
  });

  it("keeps the per-rule error handling while paging: a failing rule does not stop the batch or the pages", async () => {
    const first = batchOf("r", 0, ALERT_RULE_EVAL_BATCH_SIZE);
    const second = batchOf("r", ALERT_RULE_EVAL_BATCH_SIZE, 1);
    let calls = 0;
    mockAlertRuleFindMany.mockImplementation(async (args: { where: { id?: { gt?: string } } }) => {
      calls += 1;
      if (calls > 10) throw new Error("findMany called too often: the page cursor is not advancing");
      const after = args.where.id?.gt;
      if (after === undefined) return first;
      if (after === first[first.length - 1].id) return second;
      return [];
    });
    // The 7th rule hits a failing lookup; the loop must keep going.
    let reached = 0;
    mockMaintenanceWindowFindFirst.mockImplementation(async () => {
      reached += 1;
      if (reached === 7) throw new Error("db hiccup");
      return null;
    });

    await privateWorker(new AlertEvaluationWorker()).evaluate();

    // Every rule of both batches reached the per-handler try/catch exactly once.
    expect(mockMetricsEvaluationsInc).toHaveBeenCalledTimes(ALERT_RULE_EVAL_BATCH_SIZE + 1);
    expect(mockMetricsEvaluationsInc).toHaveBeenCalledWith({ status: "error" });
    expect(mockMetricsEvaluationsInc).toHaveBeenCalledWith({ status: "ok" });
  });
});

// ---------------------------------------------------------------------------
// Per-tick rule budget and keyset rotation
// ---------------------------------------------------------------------------

describe("AlertEvaluationWorker: per-tick rule budget and rotation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockConfig.alertEvalMaxRulesPerTick = 1000;
    // Nothing triggers: counts stay below every rule's threshold.
    mockMaintenanceWindowFindFirst.mockResolvedValue(null);
    mockAlertIncidentFindFirst.mockResolvedValue(null);
    stubClickhouseCount(0);
  });

  // A mutable, id-sorted rule list with real keyset semantics: findMany
  // returns the first `take` enabled rules with id > where.id.gt. Rules can
  // be added to or spliced out of the backing array between ticks.
  function stubRuleList(rules: Array<ReturnType<typeof makeRule>>) {
    mockAlertRuleFindMany.mockImplementation(
      async (args: { where: { id?: { gt?: string } }; take: number }) => {
        const sorted = rules.slice().sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
        const after = args.where.id?.gt;
        const start = after === undefined ? sorted : sorted.filter((r) => r.id > after);
        return start.slice(0, args.take);
      },
    );
  }

  // Every rule that reaches the evaluation gates runs the dedup lookup with
  // its own id, so the call order records the evaluated rule ids.
  function evaluatedIds(): string[] {
    return mockAlertIncidentFindFirst.mock.calls.map(
      (c) => (c[0] as { where: { ruleId: string } }).where.ruleId,
    );
  }

  function idRules(ids: string[]) {
    return ids.map((id) => makeRule({ id }));
  }

  it("budget above the rule count: one tick evaluates all rules and the cursor stays at the start", async () => {
    mockConfig.alertEvalMaxRulesPerTick = 1000;
    stubRuleList(idRules(["01", "02", "03"]));
    const worker = new AlertEvaluationWorker();
    const pw = privateWorker(worker);

    await pw.evaluate();

    expect(evaluatedIds()).toEqual(["01", "02", "03"]);
    expect(mockAlertRuleFindMany).toHaveBeenCalledTimes(1);
    expect(pw.cursorAfterId).toBeNull();
    expect(pw.passTicks).toBe(0);
    // A one-tick pass needs no multi-tick warn.
    expect(mockLogWarn).not.toHaveBeenCalled();
    expect(mockMetricsPassTicksSet).toHaveBeenCalledWith(1);
  });

  it("budget below the rule count: a tick stops at the budget and the next tick continues after the last evaluated id", async () => {
    mockConfig.alertEvalMaxRulesPerTick = 2;
    stubRuleList(idRules(["01", "02", "03", "04", "05"]));
    const worker = new AlertEvaluationWorker();
    const pw = privateWorker(worker);

    await pw.evaluate();
    expect(evaluatedIds()).toEqual(["01", "02"]);
    expect(mockAlertRuleFindMany).toHaveBeenCalledTimes(1);
    expect(pw.cursorAfterId).toBe("02");

    await pw.evaluate();
    expect(evaluatedIds()).toEqual(["01", "02", "03", "04"]);
    // The second tick's only page starts after the first tick's last rule.
    expect(mockAlertRuleFindMany).toHaveBeenLastCalledWith(
      expect.objectContaining({ where: { enabled: true, id: { gt: "02" } }, take: 2 }),
    );
    expect(pw.cursorAfterId).toBe("04");
  });

  it("two ticks cover all rules exactly once and the finished pass warns once with its length", async () => {
    mockConfig.alertEvalMaxRulesPerTick = 2;
    stubRuleList(idRules(["01", "02", "03"]));
    const worker = new AlertEvaluationWorker();
    const pw = privateWorker(worker);

    await pw.evaluate();
    await pw.evaluate();

    expect([...new Set(evaluatedIds())].sort()).toEqual(["01", "02", "03"]);
    expect(evaluatedIds()).toHaveLength(3);
    // The pass ended on the second tick (a short page): one warn, pass length
    // in ticks and the rule count.
    expect(mockLogWarn).toHaveBeenCalledTimes(1);
    expect(mockLogWarn).toHaveBeenCalledWith(
      expect.objectContaining({ passTicks: 2, rules: 3, maxRulesPerTick: 2 }),
      expect.stringContaining("several ticks"),
    );
    expect(mockMetricsPassTicksSet).toHaveBeenLastCalledWith(2);
    expect(pw.cursorAfterId).toBeNull();
    expect(pw.passTicks).toBe(0);
  });

  it("budget equal to the rule count: the first tick evaluates every rule exactly once", async () => {
    mockConfig.alertEvalMaxRulesPerTick = 3;
    stubRuleList(idRules(["01", "02", "03"]));
    const worker = new AlertEvaluationWorker();
    const pw = privateWorker(worker);

    await pw.evaluate();

    // A page cut exactly by the budget is full, so the list end is not known
    // yet: all three rules were evaluated in this one tick and the cursor
    // waits at the last id; the next tick probes, finds nothing, and ends the
    // pass without re-evaluating anything.
    expect(evaluatedIds()).toEqual(["01", "02", "03"]);
    expect(pw.cursorAfterId).toBe("03");

    await pw.evaluate();
    expect(evaluatedIds()).toEqual(["01", "02", "03"]);
    expect(pw.cursorAfterId).toBeNull();
  });

  it("wrap-around: after a pass ends, the next tick starts again from the beginning of the list", async () => {
    mockConfig.alertEvalMaxRulesPerTick = 1;
    stubRuleList(idRules(["01", "02"]));
    const worker = new AlertEvaluationWorker();
    const pw = privateWorker(worker);

    await pw.evaluate(); // 01
    await pw.evaluate(); // 02
    await pw.evaluate(); // probe: list end, pass over
    expect(evaluatedIds()).toEqual(["01", "02"]);
    expect(pw.cursorAfterId).toBeNull();

    await pw.evaluate(); // wraps to 01
    expect(mockAlertRuleFindMany).toHaveBeenLastCalledWith(
      expect.objectContaining({ where: { enabled: true } }),
    );
    expect(mockAlertRuleFindMany.mock.calls.at(-1)?.[0]).not.toHaveProperty("where.id");
    expect(evaluatedIds()).toEqual(["01", "02", "01"]);
  });

  it("a page never exceeds the remaining budget when the budget is smaller than a page", async () => {
    mockConfig.alertEvalMaxRulesPerTick = 700;
    const many = idRules(Array.from({ length: 1200 }, (_, i) => `r-${String(i).padStart(4, "0")}`));
    stubRuleList(many);
    const worker = new AlertEvaluationWorker();
    const pw = privateWorker(worker);

    await pw.evaluate();

    // First page: the batch size. Second page: only the 200 rules left.
    expect(mockAlertRuleFindMany.mock.calls.map((c) => (c[0] as { take: number }).take)).toEqual([500, 200]);
    expect(mockMetricsEvaluationsInc).toHaveBeenCalledTimes(700);
    expect(pw.cursorAfterId).toBe("r-0699");
  });

  it("rules deleted between ticks do not make the cursor skip or repeat a surviving rule", async () => {
    mockConfig.alertEvalMaxRulesPerTick = 2;
    const rules = idRules(["01", "02", "03", "04", "05"]);
    stubRuleList(rules);
    const worker = new AlertEvaluationWorker();
    const pw = privateWorker(worker);

    await pw.evaluate(); // 01, 02
    // "03" sits between the cursor and the rest: an offset-based page would
    // shift and skip "04"; the keyset cursor sees every rule after "02".
    rules.splice(2, 1);

    await pw.evaluate();
    await pw.evaluate();

    expect(evaluatedIds()).toEqual(["01", "02", "04", "05"]);
    expect(new Set(evaluatedIds()).size).toBe(4);
    expect(mockMetricsPassTicksSet).toHaveBeenLastCalledWith(3);
  });

  it("rules added between ticks get their turn exactly once, before and after the cursor", async () => {
    mockConfig.alertEvalMaxRulesPerTick = 1;
    const rules = idRules(["b", "d"]);
    stubRuleList(rules);
    const worker = new AlertEvaluationWorker();
    const pw = privateWorker(worker);

    await pw.evaluate(); // b
    rules.push(makeRule({ id: "c" })); // added after the cursor: joins the running pass
    await pw.evaluate(); // c
    await pw.evaluate(); // d
    await pw.evaluate(); // probe: pass over
    expect(evaluatedIds()).toEqual(["b", "c", "d"]);
    expect(mockMetricsPassTicksSet).toHaveBeenLastCalledWith(4);

    rules.unshift(makeRule({ id: "a" })); // added before the start: next pass
    await pw.evaluate(); // wraps from the beginning: a
    expect(evaluatedIds()).toEqual(["b", "c", "d", "a"]);
  });

  it("budget changes take effect on the next tick", async () => {
    stubRuleList(idRules(["01", "02", "03", "04"]));
    const worker = new AlertEvaluationWorker();
    const pw = privateWorker(worker);

    mockConfig.alertEvalMaxRulesPerTick = 2;
    await pw.evaluate();
    expect(evaluatedIds()).toEqual(["01", "02"]);

    mockConfig.alertEvalMaxRulesPerTick = 1;
    await pw.evaluate();
    expect(evaluatedIds()).toEqual(["01", "02", "03"]);
    expect(mockAlertRuleFindMany).toHaveBeenLastCalledWith(expect.objectContaining({ take: 1 }));
  });

  it("a tick that only probes the list end evaluates no rule", async () => {
    mockConfig.alertEvalMaxRulesPerTick = 1;
    stubRuleList(idRules(["01"]));
    const pw = privateWorker(new AlertEvaluationWorker());

    await pw.evaluate(); // 01
    mockAlertIncidentFindFirst.mockClear();
    await pw.evaluate(); // probe, pass over
    expect(mockAlertIncidentFindFirst).not.toHaveBeenCalled();
    expect(mockMetricsPassTicksSet).toHaveBeenLastCalledWith(2);
  });
});
