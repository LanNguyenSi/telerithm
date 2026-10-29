import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

const mocks = vi.hoisted(() => ({
  createAlertRule: vi.fn(),
  updateAlertRule: vi.fn(),
  deleteAlertRule: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock("@/lib/api/client", () => ({
  createAlertRule: mocks.createAlertRule,
  updateAlertRule: mocks.updateAlertRule,
  deleteAlertRule: mocks.deleteAlertRule,
}));

import { AlertRulesPanel } from "@/components/alerts/alert-rules-panel";
import type { AlertRule, TeamRole } from "@/types";

const rule: AlertRule = {
  id: "rule-1",
  name: "Timeouts",
  description: "Too many timeouts",
  query: "timeout",
  condition: "GREATER_THAN",
  threshold: 5,
  windowMinutes: 10,
  enabled: true,
};

function renderPanel(role: TeamRole, rules: AlertRule[] = [rule]) {
  return render(<AlertRulesPanel rules={rules} teamId="team-1" token="tok" role={role} />);
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("AlertRulesPanel", () => {
  it.each(["OWNER", "ADMIN", "MEMBER"] as const)("shows write controls for %s", (role) => {
    renderPanel(role);
    expect(screen.getByRole("button", { name: "New rule" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete" })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: /Enabled: Timeouts/ })).toBeInTheDocument();
  });

  it("hides every write control from a VIEWER but still lists the rule", () => {
    renderPanel("VIEWER");
    expect(screen.getByText("Timeouts")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "New rule" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Delete" })).toBeNull();
    expect(screen.queryByRole("checkbox")).toBeNull();
  });

  it("empty state offers creation to writers and no longer says rules cannot be created", () => {
    renderPanel("MEMBER", []);
    expect(screen.getByText(/Create a rule with New rule/)).toBeInTheDocument();
    expect(screen.queryByText(/cannot be created or edited/i)).toBeNull();
  });

  it("empty state for a VIEWER does not offer a button that is not there", () => {
    renderPanel("VIEWER", []);
    expect(screen.getByText(/Team members with write access can create them/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "New rule" })).toBeNull();
  });

  it("submits a new rule with the team id and refreshes the list", async () => {
    mocks.createAlertRule.mockResolvedValue({ rule });
    renderPanel("MEMBER", []);

    fireEvent.click(screen.getByRole("button", { name: "New rule" }));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Timeouts" } });
    fireEvent.change(screen.getByLabelText("Query text"), { target: { value: "timeout" } });
    fireEvent.change(screen.getByLabelText("Condition"), { target: { value: "LESS_THAN" } });
    fireEvent.change(screen.getByLabelText("Threshold"), { target: { value: "3" } });
    fireEvent.change(screen.getByLabelText("Window (minutes)"), { target: { value: "15" } });
    fireEvent.click(screen.getByRole("button", { name: "Create rule" }));

    await waitFor(() => expect(mocks.createAlertRule).toHaveBeenCalledTimes(1));
    expect(mocks.createAlertRule).toHaveBeenCalledWith("tok", {
      teamId: "team-1",
      name: "Timeouts",
      description: undefined,
      query: "timeout",
      condition: "LESS_THAN",
      threshold: 3,
      windowMinutes: 15,
      enabled: true,
    });
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalled());
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("keeps the dialog open and shows the API error when saving fails", async () => {
    mocks.createAlertRule.mockRejectedValue(new Error("Forbidden"));
    renderPanel("MEMBER", []);

    fireEvent.click(screen.getByRole("button", { name: "New rule" }));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Timeouts" } });
    fireEvent.change(screen.getByLabelText("Query text"), { target: { value: "timeout" } });
    fireEvent.click(screen.getByRole("button", { name: "Create rule" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Forbidden");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it("validates before calling the API", async () => {
    renderPanel("MEMBER", []);
    fireEvent.click(screen.getByRole("button", { name: "New rule" }));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Timeouts" } });
    fireEvent.change(screen.getByLabelText("Query text"), { target: { value: "timeout" } });
    fireEvent.change(screen.getByLabelText("Window (minutes)"), { target: { value: "2000" } });
    fireEvent.click(screen.getByRole("button", { name: "Create rule" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/1 to 1440/);
    expect(mocks.createAlertRule).not.toHaveBeenCalled();
  });

  it("edits a rule with a PUT that carries the changed fields", async () => {
    mocks.updateAlertRule.mockResolvedValue({ rule });
    renderPanel("ADMIN");

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(screen.getByLabelText("Name")).toHaveValue("Timeouts");
    fireEvent.change(screen.getByLabelText("Threshold"), { target: { value: "9" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(mocks.updateAlertRule).toHaveBeenCalledTimes(1));
    const [id, token, payload] = mocks.updateAlertRule.mock.calls[0];
    expect(id).toBe("rule-1");
    expect(token).toBe("tok");
    expect(payload).toMatchObject({ threshold: 9, name: "Timeouts", condition: "GREATER_THAN" });
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalled());
  });

  it("sends description null when an existing description is cleared on edit", async () => {
    mocks.updateAlertRule.mockResolvedValue({ rule });
    renderPanel("ADMIN");

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(screen.getByLabelText("Description (optional)")).toHaveValue("Too many timeouts");
    fireEvent.change(screen.getByLabelText("Description (optional)"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(mocks.updateAlertRule).toHaveBeenCalledTimes(1));
    const payload = mocks.updateAlertRule.mock.calls[0][2];
    expect(payload).toHaveProperty("description", null);
  });

  it("asks for a supported condition when the stored rule uses ANOMALY_DETECTED", () => {
    renderPanel("ADMIN", [{ ...rule, condition: "ANOMALY_DETECTED" }]);
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(screen.getByText(/ANOMALY_DETECTED, which is no longer supported/)).toBeInTheDocument();
  });

  it("toggles enabled with a partial update", async () => {
    mocks.updateAlertRule.mockResolvedValue({ rule });
    renderPanel("MEMBER");

    fireEvent.click(screen.getByRole("checkbox", { name: /Enabled: Timeouts/ }));

    await waitFor(() => expect(mocks.updateAlertRule).toHaveBeenCalledWith("rule-1", "tok", { enabled: false }));
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalled());
  });

  it("deletes only after the confirm dialog is accepted", async () => {
    mocks.deleteAlertRule.mockResolvedValue(undefined);
    renderPanel("OWNER");

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(screen.getByText(/Delete rule "Timeouts"\?/)).toBeInTheDocument();
    expect(mocks.deleteAlertRule).not.toHaveBeenCalled();

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("button", { name: "Cancel" })).toBeInTheDocument();
    expect(within(dialog).getByText(/subscriptions that target this rule/)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));

    await waitFor(() => expect(mocks.deleteAlertRule).toHaveBeenCalledWith("rule-1", "tok"));
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalled());
  });

  it("does not delete when the confirm dialog is cancelled", () => {
    renderPanel("OWNER");
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" }));
    expect(mocks.deleteAlertRule).not.toHaveBeenCalled();
    expect(screen.queryByText(/Delete rule/)).toBeNull();
  });

  it("shows an error when the delete fails", async () => {
    mocks.deleteAlertRule.mockRejectedValue(new Error("Alert rule not found"));
    renderPanel("OWNER");
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Delete" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Alert rule not found");
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it("makes the Enabled control a 24px-tall target (WCAG 2.5.8)", () => {
    renderPanel("MEMBER");
    const checkbox = screen.getByRole("checkbox", { name: /Enabled: Timeouts/ });
    const label = checkbox.closest("label");
    expect(label).not.toBeNull();
    expect((label as HTMLLabelElement).className).toContain("min-h-6");
    expect(checkbox.className).toContain("size-4");
  });
});
