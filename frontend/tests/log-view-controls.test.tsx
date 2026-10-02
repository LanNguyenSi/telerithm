import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Dialog } from "@/components/ui/dialog";
import { SavedViewBar } from "@/components/logs/saved-view-bar";
import { SHARED_VIEWS_REASON, canManageSharedViews } from "@/components/logs/log-auth-context";
import type { SavedLogView, TeamRole } from "@/types";

afterEach(() => cleanup());

const view = {
  id: "v1",
  name: "Errors",
  isShared: false,
  isDefault: false,
} as unknown as SavedLogView;

function renderBar(role: TeamRole, onSetDefault = vi.fn()) {
  render(
    <SavedViewBar
      views={[view]}
      selectedId="v1"
      unsaved={false}
      loading={false}
      onSelect={() => {}}
      onSave={() => {}}
      onOverwrite={() => {}}
      onDuplicate={() => {}}
      onRename={() => {}}
      onDelete={() => {}}
      onSetDefault={onSetDefault}
      canManageShared={canManageSharedViews(role)}
      sharedDisabledReason={SHARED_VIEWS_REASON}
    />,
  );
  return onSetDefault;
}

function renderDialog(role: TeamRole, onConfirm = vi.fn()) {
  render(
    <Dialog
      open
      variant="save-view"
      title="Ansicht speichern"
      defaultName="My view"
      canManageShared={canManageSharedViews(role)}
      disabledReason={SHARED_VIEWS_REASON}
      onClose={() => {}}
      onConfirm={onConfirm}
    />,
  );
  return onConfirm;
}

describe("canManageSharedViews", () => {
  it.each([
    ["OWNER", true],
    ["ADMIN", true],
    ["MEMBER", false],
    ["VIEWER", false],
  ] as const)("%s -> %s", (role, expected) => {
    expect(canManageSharedViews(role)).toBe(expected);
  });
});

describe.each(["OWNER", "ADMIN"] as const)("log view controls for %s", (role) => {
  it("keeps Set Default enabled and calls through", () => {
    const onSetDefault = renderBar(role);
    const button = screen.getByRole("button", { name: "Set Default" });
    expect(button).toBeEnabled();
    fireEvent.click(button);
    expect(onSetDefault).toHaveBeenCalledTimes(1);
  });

  it("keeps the share and default checkboxes enabled and submits them", () => {
    const onConfirm = renderDialog(role);
    const share = screen.getByLabelText("Team-weit teilen");
    const def = screen.getByLabelText("Als Standardansicht setzen");
    expect(share).toBeEnabled();
    expect(def).toBeEnabled();
    expect(screen.queryByText(SHARED_VIEWS_REASON)).not.toBeInTheDocument();
    fireEvent.click(share);
    fireEvent.click(def);
    fireEvent.click(screen.getByRole("button", { name: /speichern|bestätigen|ok/i }));
    expect(onConfirm).toHaveBeenCalledWith({ name: "My view", shared: true, isDefault: true });
  });
});

describe("fail-closed defaults", () => {
  it("treats an absent role as not allowed", () => {
    expect(canManageSharedViews(undefined as unknown as TeamRole)).toBe(false);
  });

  it("disables the dialog options when the prop is omitted at runtime", () => {
    const onConfirm = vi.fn();
    render(
      <Dialog
        open
        variant="save-view"
        title="Ansicht speichern"
        defaultName="My view"
        {...({} as { canManageShared: boolean })}
        disabledReason={SHARED_VIEWS_REASON}
        onClose={() => {}}
        onConfirm={onConfirm}
      />,
    );
    expect(screen.getByLabelText("Team-weit teilen")).toBeDisabled();
    expect(screen.getByLabelText("Als Standardansicht setzen")).toBeDisabled();
  });

  it("disables Set Default when the bar prop is omitted at runtime", () => {
    render(
      <SavedViewBar
        views={[view]}
        selectedId="v1"
        unsaved={false}
        loading={false}
        onSelect={() => {}}
        onSave={() => {}}
        onOverwrite={() => {}}
        onDuplicate={() => {}}
        onRename={() => {}}
        onDelete={() => {}}
        onSetDefault={() => {}}
        {...({} as { canManageShared: boolean })}
      />,
    );
    expect(screen.getByRole("button", { name: "Set Default" })).toBeDisabled();
  });

  it("never submits shared or default when permission is lost after the boxes were ticked", () => {
    const onConfirm = vi.fn();
    const props = {
      open: true,
      variant: "save-view" as const,
      title: "Ansicht speichern",
      defaultName: "My view",
      disabledReason: SHARED_VIEWS_REASON,
      onClose: () => {},
      onConfirm,
    };
    const { rerender } = render(<Dialog {...props} canManageShared={true} />);
    fireEvent.click(screen.getByLabelText("Team-weit teilen"));
    fireEvent.click(screen.getByLabelText("Als Standardansicht setzen"));
    rerender(<Dialog {...props} canManageShared={false} />);
    fireEvent.click(screen.getByRole("button", { name: /speichern|bestätigen|ok/i }));
    expect(onConfirm).toHaveBeenCalledWith({ name: "My view", shared: false, isDefault: false });
  });
});

describe.each(["MEMBER", "VIEWER"] as const)("log view controls for %s", (role) => {
  it("disables Set Default with the reason and does not call through", () => {
    const onSetDefault = renderBar(role);
    const button = screen.getByRole("button", { name: "Set Default" });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("title", SHARED_VIEWS_REASON);
    expect(button.getAttribute("aria-describedby")).toBe(screen.getByText(SHARED_VIEWS_REASON).id);
    fireEvent.click(button);
    expect(onSetDefault).not.toHaveBeenCalled();
  });

  it("disables the share and default checkboxes, shows the reason, submits a private view", () => {
    const onConfirm = renderDialog(role);
    expect(screen.getByLabelText("Team-weit teilen")).toBeDisabled();
    expect(screen.getByLabelText("Als Standardansicht setzen")).toBeDisabled();
    expect(screen.getByText(SHARED_VIEWS_REASON)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /speichern|bestätigen|ok/i }));
    expect(onConfirm).toHaveBeenCalledWith({ name: "My view", shared: false, isDefault: false });
  });
});
