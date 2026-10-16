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
