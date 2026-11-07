import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { SubscriptionForm } from "@/app/(dashboard)/alerts/subscriptions/subscription-form";
import type { AlertRule } from "@/types";

const rules = [
  { id: "r1", name: "High error rate" },
  { id: "r2", name: "Checkout burst" },
] as unknown as AlertRule[];

const URL_A = "https://hooks.example.com/typed";
const SECRET_A = "typed-signing-secret";

function formProps(overrides: { open: boolean; initialRuleId: string }) {
  return { ...overrides, rules, teamId: "team-1", onClose: vi.fn(), onSubmit: vi.fn().mockResolvedValue(undefined) };
}

afterEach(() => cleanup());

describe("SubscriptionForm reset scopes", () => {
  it("keeps url and secret and updates only the rule when initialRuleId changes while open", () => {
    const view = render(<SubscriptionForm {...formProps({ open: true, initialRuleId: "" })} />);
    fireEvent.change(screen.getByLabelText("Webhook URL"), { target: { value: URL_A } });
    fireEvent.change(screen.getByLabelText("Signing secret (optional)"), { target: { value: SECRET_A } });

    view.rerender(<SubscriptionForm {...formProps({ open: true, initialRuleId: "r2" })} />);

    expect(screen.getByLabelText("Webhook URL")).toHaveValue(URL_A);
    expect(screen.getByLabelText("Signing secret (optional)")).toHaveValue(SECRET_A);
    expect(screen.getByLabelText("Rule")).toHaveValue("r2");
  });

  it("closes with the fields cleared: a reopen starts empty with no leftover rule choice", () => {
    const view = render(<SubscriptionForm {...formProps({ open: true, initialRuleId: "" })} />);
    fireEvent.change(screen.getByLabelText("Webhook URL"), { target: { value: URL_A } });
    fireEvent.change(screen.getByLabelText("Signing secret (optional)"), { target: { value: SECRET_A } });
    fireEvent.change(screen.getByLabelText("Rule"), { target: { value: "r1" } });

    view.rerender(<SubscriptionForm {...formProps({ open: false, initialRuleId: "" })} />);
    view.rerender(<SubscriptionForm {...formProps({ open: true, initialRuleId: "" })} />);

    expect(screen.getByLabelText("Webhook URL")).toHaveValue("");
    expect(screen.getByLabelText("Signing secret (optional)")).toHaveValue("");
    expect(screen.getByLabelText("Rule")).toHaveValue("");
  });

  it("preselects the current rule when reopening with a rule id", () => {
    const view = render(<SubscriptionForm {...formProps({ open: true, initialRuleId: "r1" })} />);
    expect(screen.getByLabelText("Rule")).toHaveValue("r1");
    fireEvent.change(screen.getByLabelText("Rule"), { target: { value: "" } });
    view.rerender(<SubscriptionForm {...formProps({ open: false, initialRuleId: "r1" })} />);
    view.rerender(<SubscriptionForm {...formProps({ open: true, initialRuleId: "r1" })} />);
    expect(screen.getByLabelText("Rule")).toHaveValue("r1");
  });
});
