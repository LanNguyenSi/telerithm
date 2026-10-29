import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

const mocks = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  getSubscriptions: vi.fn(),
  getAlertRules: vi.fn(),
}));

vi.mock("@/lib/auth/guard", () => ({ requireAuth: mocks.requireAuth }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

vi.mock("@/lib/api/client", () => ({
  getSubscriptions: mocks.getSubscriptions,
  getAlertRules: mocks.getAlertRules,
}));

import SubscriptionsPage from "@/app/(dashboard)/alerts/subscriptions/page";

const team = { id: "team-1", name: "Team One", slug: "team-one", role: "MEMBER" };

async function renderEmptyState(role = "MEMBER") {
  mocks.requireAuth.mockResolvedValue({ token: "tok", team: { ...team, role } });
  mocks.getSubscriptions.mockResolvedValue({ subscriptions: [] });
  mocks.getAlertRules.mockResolvedValue({ rules: [] });
  render(await SubscriptionsPage());
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("subscriptions page empty state", () => {
  it("no longer tells the user to call the API", async () => {
    await renderEmptyState();
    expect(screen.queryByText(/POST \/api\/v1\/subscriptions/)).toBeNull();
    expect(screen.queryByText(/not created in the UI yet/i)).toBeNull();
  });

  it("offers a call to action that opens the create form", async () => {
    await renderEmptyState();
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Create your first subscription" }));
    expect(screen.getByRole("dialog", { name: "New subscription" })).toBeInTheDocument();
  });

  it("does not offer EMAIL as a channel", async () => {
    await renderEmptyState();
    fireEvent.click(screen.getByRole("button", { name: "Create your first subscription" }));
    const channel = screen.getByLabelText("Channel") as HTMLSelectElement;
    expect(Array.from(channel.options).map((o) => o.value)).toEqual(["WEBHOOK", "SLACK", "MSTEAMS"]);
  });

  it("keeps the controls for a VIEWER, because the API lets every team member manage their own subscriptions", async () => {
    await renderEmptyState("VIEWER");
    expect(screen.getByRole("button", { name: "New subscription" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create your first subscription" })).toBeInTheDocument();
  });
});
