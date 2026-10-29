import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const mocks = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  getSubscriptions: vi.fn(),
  getAlertRules: vi.fn(),
  createSubscription: vi.fn(),
  updateSubscription: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock("@/lib/auth/guard", () => ({ requireAuth: mocks.requireAuth }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock("@/lib/api/client", () => ({
  getSubscriptions: mocks.getSubscriptions,
  getAlertRules: mocks.getAlertRules,
  createSubscription: mocks.createSubscription,
  updateSubscription: mocks.updateSubscription,
  deleteSubscription: vi.fn(),
  testSubscription: vi.fn(),
}));

import SubscriptionsPage from "@/app/(dashboard)/alerts/subscriptions/page";
import { SubscriptionForm } from "@/app/(dashboard)/alerts/subscriptions/subscription-form";
import { SubscriptionsView } from "@/app/(dashboard)/alerts/subscriptions/subscriptions-view";
import type { AlertRule, AlertSubscription } from "@/types";

const SECRET = "topsecret-hmac";
const HOOK = "https://hooks.slack.test/services/T000/B000/xyzzy";
const WEBHOOK_URL = "https://pager.example.test/in/abc123";

const rules: AlertRule[] = [
  { id: "r1", name: "High error rate", query: "error", condition: "GREATER_THAN", threshold: 50, windowMinutes: 5, enabled: true },
];

const base: AlertSubscription = {
  id: "sub-1",
  userId: "u1",
  teamId: "team-1",
  ruleId: "r1",
  channel: "SLACK",
  config: { webhook_url: HOOK },
  severities: [],
  enabled: true,
  createdAt: "2026-01-05T08:00:00.000Z",
  rule: { id: "r1", name: "High error rate" },
};
const webhookSub: AlertSubscription = {
  ...base,
  id: "sub-2",
  channel: "WEBHOOK",
  config: { url: WEBHOOK_URL, secret: SECRET },
};

type Fiber = { stateNode: { current: Fiber } | null; child: Fiber | null; sibling: Fiber | null; memoizedState: unknown; type: unknown };

/** Serialises every hook state held by components below the container, i.e. what React keeps in memory. */
function reactStateDump(container: HTMLElement): string {
  const key = Object.keys(container).find((k) => k.startsWith("__reactContainer$"));
  if (!key) throw new Error("React root not found");
  const out: string[] = [];
  const walk = (fiber: Fiber | null) => {
    for (let f = fiber; f; f = f.sibling) {
      if (typeof f.type === "function") {
        for (let hook = f.memoizedState as { memoizedState: unknown; next: unknown } | null; hook; hook = hook.next as typeof hook) {
          try {
            out.push(JSON.stringify(hook.memoizedState) ?? "");
          } catch {
            // refs and effects are not serialisable and carry no subscription data
          }
        }
      }
      walk(f.child);
    }
  };
  // The container key can point at the alternate (stale) root fiber; the live tree hangs off the FiberRoot.
  const hostRoot = (container as unknown as Record<string, Fiber>)[key];
  walk(hostRoot.stateNode?.current ?? hostRoot);
  return out.join("\n");
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("subscription config stays on the server", () => {
  it("the page hands the client component rows without config", async () => {
    mocks.requireAuth.mockResolvedValue({ token: "tok", team: { id: "team-1", name: "T", slug: "t", role: "MEMBER" } });
    mocks.getSubscriptions.mockResolvedValue({ subscriptions: [base, webhookSub] });
    mocks.getAlertRules.mockResolvedValue({ rules });

    const element = await SubscriptionsPage();
    const props = element.props as { subscriptions: Array<Record<string, unknown>> };
    expect(props.subscriptions).toHaveLength(2);
    for (const row of props.subscriptions) expect("config" in row).toBe(false);
    const serialized = JSON.stringify(element.props);
    for (const leaked of [SECRET, HOOK, WEBHOOK_URL]) expect(serialized).not.toContain(leaked);

    const { container } = render(element);
    for (const leaked of [SECRET, HOOK, WEBHOOK_URL]) expect(container.innerHTML).not.toContain(leaked);
    expect(screen.getAllByRole("article").length).toBeGreaterThan(0);
  });

  it("a created subscription is stored without its config", async () => {
    mocks.createSubscription.mockResolvedValue({
      subscription: { ...webhookSub, id: "sub-new" },
    });
    const { container } = render(<SubscriptionsView subscriptions={[]} rules={rules} teamId="team-1" token="tok" />);
    fireEvent.click(screen.getByRole("button", { name: "New subscription" }));
    fireEvent.change(screen.getByLabelText("Webhook URL"), { target: { value: WEBHOOK_URL } });
    fireEvent.change(screen.getByLabelText("Signing secret (optional)"), { target: { value: SECRET } });
    fireEvent.click(screen.getByRole("button", { name: "Create subscription" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.getByText("Rule: High error rate")).toBeInTheDocument();
    const state = reactStateDump(container);
    expect(state).toContain("sub-new");
    for (const leaked of [SECRET, WEBHOOK_URL]) {
      expect(container.innerHTML).not.toContain(leaked);
      expect(state).not.toContain(leaked);
    }
  });

  it("toggling enabled keeps the row free of the config the API echoes back", async () => {
    mocks.updateSubscription.mockResolvedValue({ subscription: { ...base, enabled: false } });
    const { config: _config, ...row } = base;
    void _config;
    const { container } = render(<SubscriptionsView subscriptions={[row]} rules={rules} teamId="team-1" token="tok" />);
    fireEvent.click(screen.getByRole("checkbox"));
    await waitFor(() => expect(screen.getByText("DISABLED")).toBeInTheDocument());
    expect(container.innerHTML).not.toContain(HOOK);
    expect(reactStateDump(container)).not.toContain(HOOK);
  });
});

describe("create form clears url and secret", () => {
  function renderForm(onSubmit: () => Promise<void>) {
    return render(
      <SubscriptionForm open rules={rules} initialRuleId="" teamId="team-1" onClose={vi.fn()} onSubmit={onSubmit} />,
    );
  }

  it("after a successful submit", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    renderForm(onSubmit);
    fireEvent.change(screen.getByLabelText("Webhook URL"), { target: { value: WEBHOOK_URL } });
    fireEvent.change(screen.getByLabelText("Signing secret (optional)"), { target: { value: SECRET } });
    fireEvent.click(screen.getByRole("button", { name: "Create subscription" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByLabelText("Webhook URL")).toHaveValue(""));
    expect(screen.getByLabelText("Signing secret (optional)")).toHaveValue("");
  });

  it("keeps the values after a rejected submit so the user can correct them", async () => {
    const onSubmit = vi.fn().mockRejectedValue(new Error("Webhook host resolves to a blocked address range"));
    renderForm(onSubmit);
    fireEvent.change(screen.getByLabelText("Webhook URL"), { target: { value: WEBHOOK_URL } });
    fireEvent.change(screen.getByLabelText("Signing secret (optional)"), { target: { value: SECRET } });
    fireEvent.click(screen.getByRole("button", { name: "Create subscription" }));
    await screen.findByRole("alert");
    expect(screen.getByLabelText("Webhook URL")).toHaveValue(WEBHOOK_URL);
    expect(screen.getByLabelText("Signing secret (optional)")).toHaveValue(SECRET);
  });

  it("when the dialog closes without submitting", () => {
    const props = { rules, initialRuleId: "", teamId: "team-1", onClose: vi.fn(), onSubmit: vi.fn() };
    const { container, rerender } = render(<SubscriptionForm open {...props} />);
    fireEvent.change(screen.getByLabelText("Webhook URL"), { target: { value: WEBHOOK_URL } });
    fireEvent.change(screen.getByLabelText("Signing secret (optional)"), { target: { value: SECRET } });
    expect(reactStateDump(container)).toContain(SECRET);

    rerender(<SubscriptionForm open={false} {...props} />);
    const state = reactStateDump(container);
    expect(state).not.toContain(SECRET);
    expect(state).not.toContain(WEBHOOK_URL);
  });
});
