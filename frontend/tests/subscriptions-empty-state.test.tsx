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

const team = { id: "team-1", name: "Team One", slug: "team-one" };

async function renderEmptyState() {
  mocks.requireAuth.mockResolvedValue({ token: "tok", team });
  mocks.getSubscriptions.mockResolvedValue({ subscriptions: [] });
  mocks.getAlertRules.mockResolvedValue({ rules: [] });
  render(await SubscriptionsPage());
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("subscriptions page empty state", () => {
  it("says subscriptions are created through the API, not the UI", async () => {
    await renderEmptyState();
    expect(screen.getByText(/POST \/api\/v1\/subscriptions/)).toBeInTheDocument();
    expect(screen.getByText(/not created in the UI yet/i)).toBeInTheDocument();
    expect(screen.getByText(/WEBHOOK, SLACK or MSTEAMS/i)).toBeInTheDocument();
    expect(screen.queryByText(/EMAIL/)).toBeNull();
  });

  it("no longer suggests creating one to get notified", async () => {
    await renderEmptyState();
    expect(screen.queryByText(/Create one to get notified/i)).toBeNull();
  });
});
