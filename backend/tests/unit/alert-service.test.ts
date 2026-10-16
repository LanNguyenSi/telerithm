import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mocks — must appear before any import that resolves the mocked modules
// ---------------------------------------------------------------------------

const {
  mockAlertRuleFindMany,
  mockAlertRuleCreate,
  mockAlertRuleUpdate,
  mockAlertRuleDelete,
  mockSubscriptionDeleteMany,
  mockAlertIncidentFindMany,
  mockAlertIncidentFindFirst,
  mockAlertIncidentUpdate,
  mockIncidentEventCreate,
  mockIncidentEventFindMany,
  mockTransaction,
} = vi.hoisted(() => ({
  mockAlertRuleFindMany: vi.fn(),
  mockAlertRuleCreate: vi.fn(),
  mockAlertRuleUpdate: vi.fn(),
  mockAlertRuleDelete: vi.fn(),
  mockSubscriptionDeleteMany: vi.fn(),
  mockAlertIncidentFindMany: vi.fn(),
  mockAlertIncidentFindFirst: vi.fn(),
  mockAlertIncidentUpdate: vi.fn(),
  mockIncidentEventCreate: vi.fn(),
  mockIncidentEventFindMany: vi.fn(),
  mockTransaction: vi.fn(),
}));

vi.mock("../../src/repositories/prisma.js", () => ({
  prisma: {
    alertRule: {
      findMany: mockAlertRuleFindMany,
      create: mockAlertRuleCreate,
      update: mockAlertRuleUpdate,
      delete: mockAlertRuleDelete,
    },
    alertSubscription: {
      deleteMany: mockSubscriptionDeleteMany,
    },
    alertIncident: {
      findMany: mockAlertIncidentFindMany,
      findFirst: mockAlertIncidentFindFirst,
      update: mockAlertIncidentUpdate,
    },
    incidentEvent: {
      create: mockIncidentEventCreate,
      findMany: mockIncidentEventFindMany,
    },
    $transaction: mockTransaction,
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

import { AlertService, INCIDENT_TRANSITIONS } from "../../src/services/alert/alert-service.js";
import { ConflictError, NotFoundError } from "../../src/errors.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const TEAM_ID = "team-abc";

function makePrismaRule(overrides: Record<string, unknown> = {}) {
  return {
    id: "rule-1",
    teamId: TEAM_ID,
    name: "High Error Rate",
    description: null,
    query: "error",
    queryType: "SQL",
    condition: "GREATER_THAN",
    threshold: 10,
    windowMinutes: 5,
    enabled: true,
    createdAt: new Date("2024-01-15T10:00:00.000Z"),
    ...overrides,
  };
}

function makePrismaIncident(overrides: Record<string, unknown> = {}) {
  return {
    id: "inc-1",
    ruleId: "rule-1",
    status: "OPEN",
    severity: "CRITICAL",
    message: "Alert triggered",
    createdAt: new Date("2024-01-15T10:00:00.000Z"),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// AlertService.listRules
// ---------------------------------------------------------------------------

describe("AlertService.listRules", () => {
  let service: AlertService;

  beforeEach(() => {
    vi.clearAllMocks();
    // Default: the incident exists inside the caller's team; the cross-team
    // tests override this with null.
    mockAlertIncidentFindFirst.mockResolvedValue({ id: "inc-1" });
    service = new AlertService();
  });

  it("calls prisma.alertRule.findMany with the given teamId", async () => {
    mockAlertRuleFindMany.mockResolvedValue([]);

    await service.listRules(TEAM_ID);

    expect(mockAlertRuleFindMany).toHaveBeenCalledWith({ where: { teamId: TEAM_ID } });
  });

  it("maps queryType 'SQL' to 'sql'", async () => {
    mockAlertRuleFindMany.mockResolvedValue([makePrismaRule({ queryType: "SQL" })]);

    const [rule] = await service.listRules(TEAM_ID);

    expect(rule.queryType).toBe("sql");
  });

  it("maps any non-SQL queryType to 'natural'", async () => {
    mockAlertRuleFindMany.mockResolvedValue([
      makePrismaRule({ queryType: "NATURAL_LANGUAGE" }),
    ]);

    const [rule] = await service.listRules(TEAM_ID);

    expect(rule.queryType).toBe("natural");
  });

  it("maps null description to undefined", async () => {
    mockAlertRuleFindMany.mockResolvedValue([makePrismaRule({ description: null })]);

    const [rule] = await service.listRules(TEAM_ID);

    expect(rule.description).toBeUndefined();
  });

  it("converts createdAt Date to ISO string", async () => {
    mockAlertRuleFindMany.mockResolvedValue([makePrismaRule()]);

    const [rule] = await service.listRules(TEAM_ID);

    expect(rule.createdAt).toBe("2024-01-15T10:00:00.000Z");
  });

  it("returns an empty array when there are no rules", async () => {
    mockAlertRuleFindMany.mockResolvedValue([]);

    const result = await service.listRules(TEAM_ID);

    expect(result).toEqual([]);
  });

  it("returns all rules returned by prisma", async () => {
    mockAlertRuleFindMany.mockResolvedValue([
      makePrismaRule({ id: "r1" }),
      makePrismaRule({ id: "r2" }),
    ]);

    const result = await service.listRules(TEAM_ID);

    expect(result).toHaveLength(2);
    expect(result[0].id).toBe("r1");
    expect(result[1].id).toBe("r2");
  });
});

// ---------------------------------------------------------------------------
// AlertService.createRule / updateRule / deleteRule
// ---------------------------------------------------------------------------

describe("AlertService rule create, update and delete", () => {
  let service: AlertService;
  const notFound = () => Object.assign(new Error("Record not found"), { code: "P2025" });

  beforeEach(() => {
    vi.resetAllMocks();
    // The array form of $transaction runs the already-started operations.
    mockTransaction.mockImplementation((ops: Promise<unknown>[]) => Promise.all(ops));
    service = new AlertService();
  });

  it("createRule writes the rule into the given team and returns the mapped rule", async () => {
    mockAlertRuleCreate.mockResolvedValue(makePrismaRule({ windowMinutes: 15, condition: "LESS_THAN" }));

    const rule = await service.createRule(TEAM_ID, {
      teamId: "ignored-body-team",
      name: "High Error Rate",
      query: "error",
      condition: "LESS_THAN",
      threshold: 10,
      windowMinutes: 15,
      enabled: true,
    });

    expect(mockAlertRuleCreate).toHaveBeenCalledWith({
      data: {
        teamId: TEAM_ID,
        name: "High Error Rate",
        description: undefined,
        query: "error",
        condition: "LESS_THAN",
        threshold: 10,
        windowMinutes: 15,
        enabled: true,
      },
    });
    expect(rule).toMatchObject({ id: "rule-1", condition: "LESS_THAN", windowMinutes: 15, queryType: "sql" });
  });

  it("updateRule scopes the write by id and teamId", async () => {
    mockAlertRuleUpdate.mockResolvedValue(makePrismaRule({ enabled: false }));

    const rule = await service.updateRule("rule-1", TEAM_ID, { enabled: false });

    expect(mockAlertRuleUpdate).toHaveBeenCalledWith({
      where: { id: "rule-1", teamId: TEAM_ID },
      data: expect.objectContaining({ enabled: false }),
    });
    expect(rule.enabled).toBe(false);
  });

  it("updateRule leaves fields that were not sent undefined, so Prisma keeps them", async () => {
    mockAlertRuleUpdate.mockResolvedValue(makePrismaRule());

    await service.updateRule("rule-1", TEAM_ID, { name: "Renamed" });

    const { data } = mockAlertRuleUpdate.mock.calls[0][0];
    expect(data.name).toBe("Renamed");
    expect(data.threshold).toBeUndefined();
    expect(data.enabled).toBeUndefined();
  });

  it("updateRule throws NotFoundError when no rule matches the id and team (cross-team id)", async () => {
    mockAlertRuleUpdate.mockRejectedValue(notFound());

    await expect(service.updateRule("rule-of-other-team", TEAM_ID, { enabled: true })).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it("updateRule rethrows errors that are not a missing record", async () => {
    const boom = new Error("db down");
    mockAlertRuleUpdate.mockRejectedValue(boom);

    await expect(service.updateRule("rule-1", TEAM_ID, { enabled: true })).rejects.toBe(boom);
  });

  it("deleteRule deletes the rule's subscriptions and the rule in one transaction, both scoped by team", async () => {
    mockSubscriptionDeleteMany.mockResolvedValue({ count: 2 });
    mockAlertRuleDelete.mockResolvedValue(makePrismaRule());

    await service.deleteRule("rule-1", TEAM_ID);

    expect(mockSubscriptionDeleteMany).toHaveBeenCalledWith({ where: { ruleId: "rule-1", teamId: TEAM_ID } });
    expect(mockAlertRuleDelete).toHaveBeenCalledWith({ where: { id: "rule-1", teamId: TEAM_ID } });
    expect(mockTransaction).toHaveBeenCalledTimes(1);
    expect(mockTransaction.mock.calls[0][0]).toHaveLength(2);
  });

  it("deleteRule throws NotFoundError when no rule matches the id and team (cross-team id)", async () => {
    mockAlertRuleDelete.mockRejectedValue(notFound());

    await expect(service.deleteRule("rule-of-other-team", TEAM_ID)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("deleteRule rethrows errors that are not a missing record", async () => {
    const boom = new Error("db down");
    mockAlertRuleDelete.mockRejectedValue(boom);

    await expect(service.deleteRule("rule-1", TEAM_ID)).rejects.toBe(boom);
  });
});

// ---------------------------------------------------------------------------
// AlertService.listIncidents
// ---------------------------------------------------------------------------

describe("AlertService.listIncidents", () => {
  let service: AlertService;

  beforeEach(() => {
    vi.clearAllMocks();
    // Default: the incident exists inside the caller's team; the cross-team
    // tests override this with null.
    mockAlertIncidentFindFirst.mockResolvedValue({ id: "inc-1" });
    service = new AlertService();
  });

  it("calls prisma.alertIncident.findMany with teamId filter via rule relation", async () => {
    mockAlertIncidentFindMany.mockResolvedValue([]);

    await service.listIncidents(TEAM_ID);

    expect(mockAlertIncidentFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { rule: { teamId: TEAM_ID } },
      }),
    );
  });

  it("orders results by createdAt descending", async () => {
    mockAlertIncidentFindMany.mockResolvedValue([]);

    await service.listIncidents(TEAM_ID);

    expect(mockAlertIncidentFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { createdAt: "desc" } }),
    );
  });

  it("takes at most 20 incidents", async () => {
    mockAlertIncidentFindMany.mockResolvedValue([]);

    await service.listIncidents(TEAM_ID);

    expect(mockAlertIncidentFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 20 }),
    );
  });

  it("converts createdAt Date to ISO string in the mapped result", async () => {
    mockAlertIncidentFindMany.mockResolvedValue([makePrismaIncident()]);

    const [inc] = await service.listIncidents(TEAM_ID);

    expect(inc.createdAt).toBe("2024-01-15T10:00:00.000Z");
  });

  it("returns empty array when no incidents", async () => {
    mockAlertIncidentFindMany.mockResolvedValue([]);

    const result = await service.listIncidents(TEAM_ID);

    expect(result).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// AlertService.acknowledgeIncident
// ---------------------------------------------------------------------------

describe("AlertService.acknowledgeIncident", () => {
  let service: AlertService;

  beforeEach(() => {
    vi.clearAllMocks();
    // Default: the incident exists inside the caller's team; the cross-team
    // tests override this with null.
    mockAlertIncidentFindFirst.mockResolvedValue({ id: "inc-1", status: "OPEN" });
    service = new AlertService();
  });

  it("calls $transaction with update(ACKNOWLEDGED) and incidentEvent.create(ACKNOWLEDGED)", async () => {
    const updatedIncident = makePrismaIncident({ status: "ACKNOWLEDGED" });
    const createdEvent = { id: "ev-1" };
    // $transaction receives array of Prisma promises; we mock update/create to return real Promises
    mockAlertIncidentUpdate.mockResolvedValue(updatedIncident);
    mockIncidentEventCreate.mockResolvedValue(createdEvent);
    mockTransaction.mockImplementation(
      async (ops: Array<Promise<unknown>>) => Promise.all(ops),
    );

    const result = await service.acknowledgeIncident("inc-1", TEAM_ID, "user-1", "ack comment");

    expect(mockTransaction).toHaveBeenCalledOnce();
    expect(mockAlertIncidentUpdate).toHaveBeenCalledWith({
      where: { id: "inc-1", status: "OPEN", rule: { teamId: TEAM_ID } },
      data: { status: "ACKNOWLEDGED" },
    });
    expect(mockIncidentEventCreate).toHaveBeenCalledWith({
      data: {
        incidentId: "inc-1",
        userId: "user-1",
        action: "ACKNOWLEDGED",
        comment: "ack comment",
      },
    });
    // Return value is the first element (the updated incident)
    expect(result).toEqual(updatedIncident);
  });

  it("works without a comment (comment is optional)", async () => {
    const updatedIncident = makePrismaIncident({ status: "ACKNOWLEDGED" });
    mockAlertIncidentUpdate.mockResolvedValue(updatedIncident);
    mockIncidentEventCreate.mockResolvedValue({ id: "ev-1" });
    mockTransaction.mockImplementation(
      async (ops: Array<Promise<unknown>>) => Promise.all(ops),
    );

    await service.acknowledgeIncident("inc-1", TEAM_ID, "user-1");

    expect(mockIncidentEventCreate).toHaveBeenCalledWith({
      data: {
        incidentId: "inc-1",
        userId: "user-1",
        action: "ACKNOWLEDGED",
        comment: undefined,
      },
    });
  });

  it("propagates errors from $transaction (e.g. record not found)", async () => {
    mockAlertIncidentUpdate.mockResolvedValue({});
    mockIncidentEventCreate.mockResolvedValue({});
    mockTransaction.mockRejectedValue(new Error("Record to update not found (P2025)"));

    await expect(service.acknowledgeIncident("missing-id", TEAM_ID, "user-1")).rejects.toThrow(
      "P2025",
    );
  });

  it("rejects a cross-team incident id before any mutation (scoped existence check)", async () => {
    mockAlertIncidentFindFirst.mockResolvedValue(null);

    await expect(
      service.acknowledgeIncident("inc-1", "team-other", "user-1"),
    ).rejects.toThrow("Incident not found");

    expect(mockAlertIncidentFindFirst).toHaveBeenCalledExactlyOnceWith({
      where: { id: "inc-1", rule: { teamId: "team-other" } },
      select: { id: true, status: true },
    });
    expect(mockTransaction).not.toHaveBeenCalled();
    expect(mockAlertIncidentUpdate).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// AlertService.resolveIncident
// ---------------------------------------------------------------------------

describe("AlertService.resolveIncident", () => {
  let service: AlertService;

  beforeEach(() => {
    vi.clearAllMocks();
    // Default: the incident exists inside the caller's team; the cross-team
    // tests override this with null.
    mockAlertIncidentFindFirst.mockResolvedValue({ id: "inc-1", status: "OPEN" });
    service = new AlertService();
  });

  it("calls $transaction with update(RESOLVED) and incidentEvent.create(RESOLVED)", async () => {
    const updatedIncident = makePrismaIncident({ status: "RESOLVED" });
    mockAlertIncidentUpdate.mockResolvedValue(updatedIncident);
    mockIncidentEventCreate.mockResolvedValue({ id: "ev-2" });
    mockTransaction.mockImplementation(
      async (ops: Array<Promise<unknown>>) => Promise.all(ops),
    );

    const result = await service.resolveIncident("inc-1", TEAM_ID, "user-1", "resolved");

    expect(mockAlertIncidentUpdate).toHaveBeenCalledWith({
      where: { id: "inc-1", status: "OPEN", rule: { teamId: TEAM_ID } },
      data: { status: "RESOLVED" },
    });
    expect(mockIncidentEventCreate).toHaveBeenCalledWith({
      data: {
        incidentId: "inc-1",
        userId: "user-1",
        action: "RESOLVED",
        comment: "resolved",
      },
    });
    expect(result).toEqual(updatedIncident);
  });

  it("propagates errors from $transaction", async () => {
    mockAlertIncidentUpdate.mockResolvedValue({});
    mockIncidentEventCreate.mockResolvedValue({});
    mockTransaction.mockRejectedValue(new Error("Record to update not found (P2025)"));

    await expect(service.resolveIncident("missing-id", TEAM_ID, "user-1")).rejects.toThrow("P2025");
  });

  it("rejects a cross-team incident id before any mutation (scoped existence check)", async () => {
    mockAlertIncidentFindFirst.mockResolvedValue(null);

    await expect(service.resolveIncident("inc-1", "team-other", "user-1")).rejects.toThrow(
      "Incident not found",
    );
    expect(mockTransaction).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// AlertService.reopenIncident
// ---------------------------------------------------------------------------

describe("AlertService.reopenIncident", () => {
  let service: AlertService;

  beforeEach(() => {
    vi.clearAllMocks();
    // Default: the incident exists inside the caller's team; the cross-team
    // tests override this with null.
    mockAlertIncidentFindFirst.mockResolvedValue({ id: "inc-1", status: "RESOLVED" });
    service = new AlertService();
  });

  it("calls $transaction with update(OPEN) and incidentEvent.create(REOPENED)", async () => {
    const updatedIncident = makePrismaIncident({ status: "OPEN" });
    mockAlertIncidentUpdate.mockResolvedValue(updatedIncident);
    mockIncidentEventCreate.mockResolvedValue({ id: "ev-3" });
    mockTransaction.mockImplementation(
      async (ops: Array<Promise<unknown>>) => Promise.all(ops),
    );

    const result = await service.reopenIncident("inc-1", TEAM_ID, "user-1", "reopened");

    expect(mockAlertIncidentUpdate).toHaveBeenCalledWith({
      where: { id: "inc-1", status: "RESOLVED", rule: { teamId: TEAM_ID } },
      data: { status: "OPEN" },
    });
    expect(mockIncidentEventCreate).toHaveBeenCalledWith({
      data: {
        incidentId: "inc-1",
        userId: "user-1",
        action: "REOPENED",
        comment: "reopened",
      },
    });
    expect(result).toEqual(updatedIncident);
  });

  it("propagates errors from $transaction", async () => {
    mockAlertIncidentUpdate.mockResolvedValue({});
    mockIncidentEventCreate.mockResolvedValue({});
    mockTransaction.mockRejectedValue(new Error("Record to update not found (P2025)"));

    await expect(service.reopenIncident("missing-id", TEAM_ID, "user-1")).rejects.toThrow("P2025");
  });

  it("rejects a cross-team incident id before any mutation (scoped existence check)", async () => {
    mockAlertIncidentFindFirst.mockResolvedValue(null);

    await expect(service.reopenIncident("inc-1", "team-other", "user-1")).rejects.toThrow(
      "Incident not found",
    );
    expect(mockTransaction).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// AlertService.getIncidentTimeline
// ---------------------------------------------------------------------------

describe("AlertService.getIncidentTimeline", () => {
  let service: AlertService;

  beforeEach(() => {
    vi.clearAllMocks();
    // Default: the incident exists inside the caller's team; the cross-team
    // tests override this with null.
    mockAlertIncidentFindFirst.mockResolvedValue({ id: "inc-1" });
    service = new AlertService();
  });

  it("calls prisma.incidentEvent.findMany with incidentId filter", async () => {
    mockIncidentEventFindMany.mockResolvedValue([]);

    await service.getIncidentTimeline("inc-1", TEAM_ID);

    expect(mockIncidentEventFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { incidentId: "inc-1", incident: { rule: { teamId: TEAM_ID } } },
      }),
    );
  });

  it("orders events ascending by createdAt", async () => {
    mockIncidentEventFindMany.mockResolvedValue([]);

    await service.getIncidentTimeline("inc-1", TEAM_ID);

    expect(mockIncidentEventFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { createdAt: "asc" } }),
    );
  });

  it("includes user details in the query", async () => {
    mockIncidentEventFindMany.mockResolvedValue([]);

    await service.getIncidentTimeline("inc-1", TEAM_ID);

    expect(mockIncidentEventFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        include: { user: { select: { id: true, name: true, email: true } } },
      }),
    );
  });

  it("returns the raw prisma result", async () => {
    const events = [
      { id: "ev-1", incidentId: "inc-1", action: "ACKNOWLEDGED", user: { id: "u1", name: "A", email: "a@b.com" } },
    ];
    mockIncidentEventFindMany.mockResolvedValue(events);

    const result = await service.getIncidentTimeline("inc-1", TEAM_ID);

    expect(result).toEqual(events);
  });

  it("returns empty array when there are no events", async () => {
    mockIncidentEventFindMany.mockResolvedValue([]);

    const result = await service.getIncidentTimeline("inc-1", TEAM_ID);

    expect(result).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Incident state transitions
// ---------------------------------------------------------------------------

type Status = "OPEN" | "ACKNOWLEDGED" | "RESOLVED";
type Action = "acknowledge" | "resolve" | "reopen";

const ALL_STATUSES: Status[] = ["OPEN", "ACKNOWLEDGED", "RESOLVED"];
// The allowed transitions, spelled out independently of INCIDENT_TRANSITIONS so
// a change to that table has to change this one too.
const EXPECTED_TARGET: Record<Action, Status> = {
  acknowledge: "ACKNOWLEDGED",
  resolve: "RESOLVED",
  reopen: "OPEN",
};
const EXPECTED_ALLOWED: Record<Action, Status[]> = {
  acknowledge: ["OPEN"],
  resolve: ["OPEN", "ACKNOWLEDGED"],
  reopen: ["RESOLVED", "ACKNOWLEDGED"],
};
const EXPECTED_EVENT: Record<Action, string> = {
  acknowledge: "ACKNOWLEDGED",
  resolve: "RESOLVED",
  reopen: "REOPENED",
};

function run(service: AlertService, action: Action) {
  const method = {
    acknowledge: service.acknowledgeIncident,
    resolve: service.resolveIncident,
    reopen: service.reopenIncident,
  }[action];
  return method.call(service, "inc-1", TEAM_ID, "user-1", "note");
}

describe("AlertService incident state transitions", () => {
  let service: AlertService;

  beforeEach(() => {
    vi.clearAllMocks();
    mockAlertIncidentUpdate.mockResolvedValue(makePrismaIncident());
    mockIncidentEventCreate.mockResolvedValue({ id: "ev-1" });
    mockTransaction.mockImplementation(async (ops: Array<Promise<unknown>>) => Promise.all(ops));
    service = new AlertService();
  });

  it("the exported table matches the documented transitions", () => {
    expect(INCIDENT_TRANSITIONS).toEqual(EXPECTED_ALLOWED);
  });

  for (const action of Object.keys(EXPECTED_ALLOWED) as Action[]) {
    for (const from of ALL_STATUSES) {
      if (EXPECTED_ALLOWED[action].includes(from)) {
        it(`${action}: ${from} -> ${EXPECTED_TARGET[action]} is applied and recorded`, async () => {
          mockAlertIncidentFindFirst.mockResolvedValue({ id: "inc-1", status: from });

          await run(service, action);

          expect(mockAlertIncidentUpdate).toHaveBeenCalledWith({
            where: { id: "inc-1", status: from, rule: { teamId: TEAM_ID } },
            data: { status: EXPECTED_TARGET[action] },
          });
          expect(mockIncidentEventCreate).toHaveBeenCalledWith({
            data: { incidentId: "inc-1", userId: "user-1", action: EXPECTED_EVENT[action], comment: "note" },
          });
        });
      } else {
        it(`${action}: ${from} is rejected with a ConflictError and nothing is written`, async () => {
          mockAlertIncidentFindFirst.mockResolvedValue({ id: "inc-1", status: from });

          const result = run(service, action);

          await expect(result).rejects.toBeInstanceOf(ConflictError);
          await expect(result).rejects.toThrow(new RegExp(`Cannot ${action} an incident that is ${from}`));
          expect(mockTransaction).not.toHaveBeenCalled();
          expect(mockAlertIncidentUpdate).not.toHaveBeenCalled();
          expect(mockIncidentEventCreate).not.toHaveBeenCalled();
        });
      }
    }
  }

  it("a RESOLVED incident cannot be acknowledged (the bug this guards)", async () => {
    mockAlertIncidentFindFirst.mockResolvedValue({ id: "inc-1", status: "RESOLVED" });

    await expect(service.acknowledgeIncident("inc-1", TEAM_ID, "user-1")).rejects.toThrow(
      "Cannot acknowledge an incident that is RESOLVED; acknowledge applies to OPEN incidents",
    );
  });

  it("an unknown or cross-team incident is a NotFoundError, not a conflict", async () => {
    mockAlertIncidentFindFirst.mockResolvedValue(null);

    await expect(service.resolveIncident("inc-1", "team-other", "user-1")).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it("an action that loses a race (no row matches the status any more) is a ConflictError", async () => {
    mockAlertIncidentFindFirst.mockResolvedValue({ id: "inc-1", status: "OPEN" });
    mockTransaction.mockRejectedValue(Object.assign(new Error("Record to update not found."), { code: "P2025" }));

    await expect(service.resolveIncident("inc-1", TEAM_ID, "user-1")).rejects.toBeInstanceOf(ConflictError);
  });

  it("other transaction errors are not turned into conflicts", async () => {
    mockAlertIncidentFindFirst.mockResolvedValue({ id: "inc-1", status: "OPEN" });
    const failure = Object.assign(new Error("connection reset"), { code: "P1001" });
    mockTransaction.mockRejectedValue(failure);

    await expect(service.resolveIncident("inc-1", TEAM_ID, "user-1")).rejects.toBe(failure);
  });
});
