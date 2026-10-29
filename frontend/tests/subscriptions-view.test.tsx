import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

const mocks = vi.hoisted(() => ({
  createSubscription: vi.fn(),
  updateSubscription: vi.fn(),
  deleteSubscription: vi.fn(),
  testSubscription: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock("@/lib/api/client", () => ({
  createSubscription: mocks.createSubscription,
  updateSubscription: mocks.updateSubscription,
  deleteSubscription: mocks.deleteSubscription,
  testSubscription: mocks.testSubscription,
}));

import { SubscriptionsView } from "@/app/(dashboard)/alerts/subscriptions/subscriptions-view";
import type { AlertRule, AlertSubscription } from "@/types";

const rules: AlertRule[] = [
  { id: "r1", name: "High error rate", query: "error", condition: "GREATER_THAN", threshold: 50, windowMinutes: 5, enabled: true },
  { id: "r2", name: "Checkout burst", query: "5xx", condition: "GREATER_THAN", threshold: 10, windowMinutes: 10, enabled: true },
];

const slackSub: AlertSubscription = {
  id: "sub-1",
  userId: "u1",
  teamId: "team-1",
  ruleId: "r1",
  channel: "SLACK",
  config: { webhook_url: "https://hooks.example.com/s" },
  severities: ["HIGH"],
  enabled: true,
  createdAt: "2026-01-05T08:00:00.000Z",
  rule: { id: "r1", name: "High error rate" },
};

const emailSub: AlertSubscription = {
  ...slackSub,
  id: "sub-2",
  ruleId: null,
  channel: "EMAIL",
  config: { email: "a@example.com" },
  severities: [],
  rule: null,
};

function renderView(subscriptions: AlertSubscription[] = [slackSub]) {
  return render(<SubscriptionsView subscriptions={subscriptions} rules={rules} teamId="team-1" token="tok" />);
}

function openForm() {
  fireEvent.click(screen.getByRole("button", { name: "New subscription" }));
  return screen.getByRole("dialog", { name: "New subscription" });
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("create form", () => {
  it("submits the exact payload and adds the row without a reload", async () => {
    mocks.createSubscription.mockResolvedValue({
      subscription: { ...slackSub, id: "sub-new", ruleId: "r2", channel: "WEBHOOK", config: {}, severities: ["CRITICAL", "LOW"], rule: undefined },
    });
    renderView([]);
    openForm();
    fireEvent.change(screen.getByLabelText("Rule"), { target: { value: "r2" } });
    fireEvent.change(screen.getByLabelText("Webhook URL"), { target: { value: "https://hooks.example.com/pager" } });
    fireEvent.change(screen.getByLabelText("Signing secret (optional)"), { target: { value: "s3cret" } });
    fireEvent.click(screen.getByRole("checkbox", { name: "LOW" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "CRITICAL" }));
    fireEvent.click(screen.getByRole("button", { name: "Create subscription" }));

    await waitFor(() => expect(mocks.createSubscription).toHaveBeenCalledTimes(1));
    expect(mocks.createSubscription).toHaveBeenCalledWith("tok", {
      teamId: "team-1",
      ruleId: "r2",
      channel: "WEBHOOK",
      config: { url: "https://hooks.example.com/pager", secret: "s3cret" },
      severities: ["CRITICAL", "LOW"],
    });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.getByText("Rule: Checkout burst")).toBeInTheDocument();
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });

  it("sends a SLACK subscription with webhook_url and no secret", async () => {
    mocks.createSubscription.mockResolvedValue({ subscription: { ...slackSub, id: "sub-new" } });
    renderView([]);
    openForm();
    fireEvent.change(screen.getByLabelText("Signing secret (optional)"), { target: { value: "left-over" } });
    fireEvent.change(screen.getByLabelText("Channel"), { target: { value: "SLACK" } });
    expect(screen.queryByLabelText("Signing secret (optional)")).toBeNull();
    fireEvent.change(screen.getByLabelText("Slack webhook URL"), { target: { value: "https://hooks.example.com/s" } });
    fireEvent.click(screen.getByRole("button", { name: "Create subscription" }));

    await waitFor(() => expect(mocks.createSubscription).toHaveBeenCalledTimes(1));
    expect(mocks.createSubscription).toHaveBeenCalledWith("tok", {
      teamId: "team-1",
      channel: "SLACK",
      config: { webhook_url: "https://hooks.example.com/s" },
      severities: [],
    });
  });

  it("blocks an empty URL before any request and marks the field invalid", () => {
    renderView([]);
    openForm();
    fireEvent.click(screen.getByRole("button", { name: "Create subscription" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Webhook URL is required.");
    expect(screen.getByLabelText("Webhook URL")).toHaveAttribute("aria-invalid", "true");
    expect(mocks.createSubscription).not.toHaveBeenCalled();
  });

  it("blocks a URL with a scheme other than http(s) before any request", () => {
    renderView([]);
    openForm();
    fireEvent.change(screen.getByLabelText("Webhook URL"), { target: { value: "ftp://hooks.example.com/x" } });
    fireEvent.click(screen.getByRole("button", { name: "Create subscription" }));
    expect(screen.getByRole("alert")).toHaveTextContent(/must start with https:\/\/ or http:\/\//);
    expect(mocks.createSubscription).not.toHaveBeenCalled();
  });

  it("shows the API's own message when it rejects the subscription and keeps the form open", async () => {
    mocks.createSubscription.mockRejectedValue(new Error("Webhook host resolves to a blocked address range"));
    renderView([]);
    openForm();
    fireEvent.change(screen.getByLabelText("Webhook URL"), { target: { value: "http://10.0.0.5/hook" } });
    fireEvent.click(screen.getByRole("button", { name: "Create subscription" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Webhook host resolves to a blocked address range");
    expect(screen.getByRole("dialog", { name: "New subscription" })).toBeInTheDocument();
    expect(screen.queryByText("DISABLED")).toBeNull();
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it("sends once when the form is submitted again while the first request is pending", async () => {
    mocks.createSubscription.mockReturnValue(new Promise(() => {}));
    renderView([]);
    const dialog = openForm();
    fireEvent.change(screen.getByLabelText("Webhook URL"), { target: { value: "https://hooks.example.com/pager" } });
    fireEvent.click(screen.getByRole("button", { name: "Create subscription" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Creating..." })).toBeDisabled());
    // Enter in a text field submits the form even though the button is disabled.
    fireEvent.submit(dialog.querySelector("form") as HTMLFormElement);
    expect(mocks.createSubscription).toHaveBeenCalledTimes(1);
  });

  it("opens with the rule preselected from the Subscribe button on a rule card", () => {
    renderView([]);
    fireEvent.click(screen.getByRole("button", { name: "Subscribe to Checkout burst" }));
    expect((screen.getByLabelText("Rule") as HTMLSelectElement).value).toBe("r2");
  });

  it("starts from all rules in the team when opened from New subscription", () => {
    renderView([]);
    openForm();
    expect((screen.getByLabelText("Rule") as HTMLSelectElement).value).toBe("");
  });

  it("closes on Escape and on Cancel without sending anything", () => {
    renderView([]);
    openForm();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    openForm();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(mocks.createSubscription).not.toHaveBeenCalled();
  });

  it("moves focus into the dialog, keeps Tab inside it, and gives focus back on close", () => {
    renderView([]);
    const opener = screen.getByRole("button", { name: "New subscription" });
    opener.focus();
    const dialog = openForm();
    expect(dialog.contains(document.activeElement)).toBe(true);

    const cancel = within(dialog).getByRole("button", { name: "Cancel" });
    const submit = within(dialog).getByRole("button", { name: "Create subscription" });
    submit.focus();
    fireEvent.keyDown(submit, { key: "Tab" });
    expect(document.activeElement).toBe(within(dialog).getByLabelText("Rule"));
    within(dialog).getByLabelText("Rule").focus();
    fireEvent.keyDown(within(dialog).getByLabelText("Rule"), { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(submit);

    fireEvent.click(cancel);
    expect(document.activeElement).toBe(opener);
  });
});

describe("delete", () => {
  it("asks first, naming the channel and the rule, and does nothing on cancel", async () => {
    renderView();
    fireEvent.click(screen.getByRole("button", { name: /^Delete SLACK subscription/ }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText('Delete the SLACK subscription for rule "High error rate"?')).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(mocks.deleteSubscription).not.toHaveBeenCalled();
    expect(screen.getByText("Rule: High error rate")).toBeInTheDocument();
  });

  it("deletes once after confirming and removes the row", async () => {
    mocks.deleteSubscription.mockResolvedValue(undefined);
    renderView([slackSub, emailSub]);
    fireEvent.click(screen.getByRole("button", { name: /^Delete SLACK subscription/ }));
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Delete" }));

    await waitFor(() => expect(screen.queryByText("Rule: High error rate")).toBeNull());
    expect(mocks.deleteSubscription).toHaveBeenCalledTimes(1);
    expect(mocks.deleteSubscription).toHaveBeenCalledWith("sub-1", "tok");
    expect(screen.getByText("All rules in team")).toBeInTheDocument();
    expect(mocks.refresh).toHaveBeenCalled();
  });

  it("names a team-wide subscription as all rules in the team", async () => {
    renderView([emailSub]);
    fireEvent.click(screen.getByRole("button", { name: /^Delete EMAIL subscription/ }));
    expect(await screen.findByText("Delete the EMAIL subscription for all rules in the team?")).toBeInTheDocument();
  });

  it("keeps the row and shows the API message when the delete is refused", async () => {
    mocks.deleteSubscription.mockRejectedValue(new Error("Forbidden"));
    renderView();
    fireEvent.click(screen.getByRole("button", { name: /^Delete SLACK subscription/ }));
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Delete" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Forbidden");
    expect(screen.getByText("Rule: High error rate")).toBeInTheDocument();
  });
});

describe("enable, disable and test", () => {
  it("switches a subscription off through the API and shows it as disabled", async () => {
    mocks.updateSubscription.mockResolvedValue({ subscription: { ...slackSub, enabled: false } });
    renderView();
    fireEvent.click(screen.getByRole("checkbox", { name: /^Enabled: SLACK subscription/ }));
    await waitFor(() => expect(screen.getByText("DISABLED")).toBeInTheDocument());
    expect(mocks.updateSubscription).toHaveBeenCalledWith("sub-1", "tok", { enabled: false });
  });

  it("switches a disabled subscription back on", async () => {
    mocks.updateSubscription.mockResolvedValue({ subscription: { ...slackSub, enabled: true } });
    renderView([{ ...slackSub, enabled: false }]);
    fireEvent.click(screen.getByRole("checkbox", { name: /^Enabled: SLACK subscription/ }));
    await waitFor(() => expect(screen.queryByText("DISABLED")).toBeNull());
    expect(mocks.updateSubscription).toHaveBeenCalledWith("sub-1", "tok", { enabled: true });
  });

  it("shows the API message and keeps the old state when the update fails", async () => {
    mocks.updateSubscription.mockRejectedValue(new Error("Subscription not found"));
    renderView();
    fireEvent.click(screen.getByRole("checkbox", { name: /^Enabled: SLACK subscription/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Subscription not found");
    expect(screen.queryByText("DISABLED")).toBeNull();
  });

  it("sends a test and shows the result on that row", async () => {
    mocks.testSubscription.mockResolvedValue({ ok: true, message: "Test notification sent" });
    renderView();
    fireEvent.click(screen.getByRole("button", { name: /^Send test notification: SLACK/ }));
    expect(await screen.findByRole("status")).toHaveTextContent("Test notification sent");
    expect(mocks.testSubscription).toHaveBeenCalledWith("sub-1", "tok");
  });

  it("shows the rate-limit or channel error from the API for a test", async () => {
    mocks.testSubscription.mockRejectedValue(new Error("The channel could not be reached"));
    renderView();
    fireEvent.click(screen.getByRole("button", { name: /^Send test notification: SLACK/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("The channel could not be reached");
  });

  it("offers no test for an EMAIL subscription, which sends nothing", () => {
    renderView([emailSub]);
    expect(screen.queryByRole("button", { name: /Send test/ })).toBeNull();
    expect(screen.getByRole("button", { name: /^Delete EMAIL subscription/ })).toBeInTheDocument();
  });
});
