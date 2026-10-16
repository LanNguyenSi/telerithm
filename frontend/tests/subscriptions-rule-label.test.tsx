import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

const mocks = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  getSubscriptions: vi.fn(),
  getAlertRules: vi.fn(),
}));

vi.mock("@/lib/auth/guard", () => ({ requireAuth: mocks.requireAuth }));

vi.mock("@/lib/api/client", () => ({
  getSubscriptions: mocks.getSubscriptions,
  getAlertRules: mocks.getAlertRules,
}));

import SubscriptionsPage from "@/app/(dashboard)/alerts/subscriptions/page";
import { subscriptionRuleLabel } from "@/lib/utils/subscription-rule-label";
import type { AlertSubscription } from "@/types";

const team = { id: "team-1", name: "Team One", slug: "team-one" };

const baseSub: AlertSubscription = {
  id: "sub-base",
  userId: "user-1",
  teamId: "team-1",
  ruleId: null,
  channel: "SLACK",
  config: {},
  severities: ["HIGH"],
  enabled: true,
  createdAt: "2026-01-05T08:00:00.000Z",
};

const ownRuleSub: AlertSubscription = {
  ...baseSub,
  id: "sub-own",
  ruleId: "rule-1",
  rule: { id: "rule-1", name: "Payment failed spike" },
};

const hiddenRuleSub: AlertSubscription = {
  ...baseSub,
  id: "sub-hidden",
  ruleId: "rule-foreign",
  rule: null,
};

const teamWideSub: AlertSubscription = {
  ...baseSub,
  id: "sub-team-wide",
  ruleId: null,
  rule: null,
};

async function renderWithSubscriptions(subscriptions: AlertSubscription[]) {
  mocks.requireAuth.mockResolvedValue({ token: "tok", team });
  mocks.getSubscriptions.mockResolvedValue({ subscriptions });
  mocks.getAlertRules.mockResolvedValue({ rules: [] });
  render(await SubscriptionsPage());
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("subscriptionRuleLabel", () => {
  it("shows the rule name when the rule object is present", () => {
    expect(subscriptionRuleLabel(ownRuleSub)).toBe("Rule: Payment failed spike");
  });

  it("says the rule is unavailable when only ruleId remains", () => {
    expect(subscriptionRuleLabel(hiddenRuleSub)).toBe("Rule unavailable");
  });

  it("says all rules in team when ruleId is null", () => {
    expect(subscriptionRuleLabel(teamWideSub)).toBe("All rules in team");
  });
});

describe("subscriptions page rule labels", () => {
  it("labels an own-rule subscription with the rule name", async () => {
    await renderWithSubscriptions([ownRuleSub]);
    expect(screen.getByText("Rule: Payment failed spike")).toBeInTheDocument();
  });

  it("labels a hidden-rule subscription as Rule unavailable, not team-wide", async () => {
    await renderWithSubscriptions([ownRuleSub, hiddenRuleSub, teamWideSub]);
    expect(screen.getByText("Rule unavailable")).toBeInTheDocument();
    expect(screen.getByText("Rule: Payment failed spike")).toBeInTheDocument();
  });

  it("shows All rules in team exactly once for the team-wide row only", async () => {
    await renderWithSubscriptions([ownRuleSub, hiddenRuleSub, teamWideSub]);
    expect(screen.getAllByText("All rules in team")).toHaveLength(1);
  });
});
