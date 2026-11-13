import { beforeEach, describe, expect, it, vi } from "vitest";

const { findMany } = vi.hoisted(() => ({ findMany: vi.fn() }));

vi.mock("../../src/logger.js", () => ({
  createChildLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

vi.mock("../../src/repositories/prisma.js", () => ({
  prisma: { alertSubscription: { findMany } },
}));

import { SubscriptionService } from "../../src/services/subscription/subscription-service.js";

const base = { userId: "u1", teamId: "t1", channel: "WEBHOOK", config: {}, severities: [], enabled: true };

describe("SubscriptionService.listByUser", () => {
  beforeEach(() => {
    findMany.mockReset();
  });

  it("queries the caller's subscriptions in the team and selects the rule's team", async () => {
    findMany.mockResolvedValue([]);

    await new SubscriptionService().listByUser("u1", "t1");

    expect(findMany).toHaveBeenCalledWith({
      where: { userId: "u1", teamId: "t1" },
      include: { rule: { select: { id: true, name: true, teamId: true } } },
      orderBy: { createdAt: "desc" },
    });
  });

  it("returns the rule of the same team without its teamId", async () => {
    findMany.mockResolvedValue([{ ...base, id: "s1", ruleId: "r1", rule: { id: "r1", name: "Own", teamId: "t1" } }]);

    const [row] = await new SubscriptionService().listByUser("u1", "t1");

    expect(row.rule).toEqual({ id: "r1", name: "Own" });
  });

  it("keeps a subscription whose rule belongs to another team but returns rule null", async () => {
    findMany.mockResolvedValue([{ ...base, id: "s2", ruleId: "r2", rule: { id: "r2", name: "Secret", teamId: "t2" } }]);

    const rows = await new SubscriptionService().listByUser("u1", "t1");

    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe("s2");
    expect(rows[0].rule).toBeNull();
    expect(JSON.stringify(rows)).not.toContain("Secret");
  });

  it("keeps a team-wide subscription (no rule) with rule null", async () => {
    findMany.mockResolvedValue([{ ...base, id: "s3", ruleId: null, rule: null }]);

    const [row] = await new SubscriptionService().listByUser("u1", "t1");

    expect(row.rule).toBeNull();
  });
});

// findForIncident decides who is notified. The fake below applies the filters
// the service sends (team, enabled, severity, rule and current membership) to
// in-memory rows, so a missing filter shows up as a wrong recipient list.
type Row = {
  id: string;
  teamId: string;
  userId: string;
  ruleId: string | null;
  enabled: boolean;
  severities: string[];
};
type Where = {
  teamId: string;
  enabled: boolean;
  user?: { status?: string; teams?: { some?: { teamId?: string } } };
  OR: Array<{ ruleId: string | null }>;
  AND: Array<{ OR: Array<{ severities: { isEmpty: true } | { has: string } }> }>;
};

describe("SubscriptionService.findForIncident", () => {
  const memberships = [
    { userId: "member", teamId: "t1" },
    { userId: "other-team-only", teamId: "t2" },
    { userId: "disabled-member", teamId: "t1" },
  ];
  const userStatus: Record<string, string> = { "disabled-member": "DISABLED" };
  const rows: Row[] = [
    { id: "from-member", teamId: "t1", userId: "member", ruleId: null, enabled: true, severities: [] },
    { id: "from-removed", teamId: "t1", userId: "removed", ruleId: null, enabled: true, severities: [] },
    {
      id: "member-other-team",
      teamId: "t1",
      userId: "other-team-only",
      ruleId: null,
      enabled: true,
      severities: [],
    },
    {
      id: "from-disabled-user",
      teamId: "t1",
      userId: "disabled-member",
      ruleId: null,
      enabled: true,
      severities: [],
    },
    { id: "member-disabled", teamId: "t1", userId: "member", ruleId: null, enabled: false, severities: [] },
    {
      id: "member-rule-match",
      teamId: "t1",
      userId: "member",
      ruleId: "r1",
      enabled: true,
      severities: ["HIGH"],
    },
    { id: "member-rule-other", teamId: "t1", userId: "member", ruleId: "r2", enabled: true, severities: [] },
    {
      id: "member-low-only",
      teamId: "t1",
      userId: "member",
      ruleId: null,
      enabled: true,
      severities: ["LOW"],
    },
  ];

  beforeEach(() => {
    findMany.mockReset();
    findMany.mockImplementation(async ({ where }: { where: Where }) =>
      rows.filter((row) => {
        if (row.teamId !== where.teamId || row.enabled !== where.enabled) return false;
        if (!where.OR.some((c) => c.ruleId === row.ruleId)) return false;
        const sev = where.AND[0].OR.some((c) =>
          "isEmpty" in c.severities ? row.severities.length === 0 : row.severities.includes(c.severities.has),
        );
        if (!sev) return false;
        if (where.user?.status && (userStatus[row.userId] ?? "ACTIVE") !== where.user.status) return false;
        const member = where.user?.teams?.some;
        if (member) {
          return memberships.some((m) => m.userId === row.userId && m.teamId === member.teamId);
        }
        return true;
      }),
    );
  });

  it("returns subscriptions of current members of the team", async () => {
    const ids = (await new SubscriptionService().findForIncident("r1", "t1", "HIGH")).map((r) => r.id);

    expect(ids).toEqual(["from-member", "member-rule-match"]);
  });

  it("does not return a row left behind by a user who is no longer a member", async () => {
    const ids = (await new SubscriptionService().findForIncident("r1", "t1", "HIGH")).map((r) => r.id);

    expect(ids).not.toContain("from-removed");
  });

  it("does not return a row of a DISABLED user who is still a member of the team", async () => {
    const ids = (await new SubscriptionService().findForIncident("r1", "t1", "HIGH")).map((r) => r.id);

    expect(ids).not.toContain("from-disabled-user");
  });

  it("does not return a row of a user who is a member of another team only", async () => {
    const ids = (await new SubscriptionService().findForIncident("r1", "t1", "HIGH")).map((r) => r.id);

    expect(ids).not.toContain("member-other-team");
  });

  it("keeps the existing filters: enabled, rule and severity", async () => {
    const ids = (await new SubscriptionService().findForIncident("r1", "t1", "HIGH")).map((r) => r.id);

    expect(ids).not.toContain("member-disabled");
    expect(ids).not.toContain("member-rule-other");
    expect(ids).not.toContain("member-low-only");
  });

  it("asks for the membership of the incident's own team", async () => {
    await new SubscriptionService().findForIncident("r1", "t1", "HIGH");

    expect(findMany.mock.calls[0][0].where.user).toEqual({
      status: "ACTIVE",
      teams: { some: { teamId: "t1" } },
    });
  });
});
