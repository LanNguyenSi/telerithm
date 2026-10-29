import { afterEach, describe, expect, it, vi } from "vitest";
import { useEffect } from "react";
import { cleanup, render, screen } from "@testing-library/react";

import { Dialog, useDialog } from "@/components/ui/dialog";

afterEach(cleanup);

describe("Dialog button labels", () => {
  it("keeps the existing defaults when no labels are passed", () => {
    render(<Dialog open variant="confirm" title="Sure?" onClose={vi.fn()} onConfirm={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Bestätigen" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Abbrechen" })).toBeInTheDocument();
  });

  it("keeps Speichern as the default for the prompt variant", () => {
    render(<Dialog open variant="prompt" title="Name" onClose={vi.fn()} onConfirm={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Speichern" })).toBeInTheDocument();
  });

  it("uses confirmLabel and cancelLabel when given", () => {
    render(
      <Dialog
        open
        variant="confirm"
        title="Sure?"
        confirmLabel="Delete"
        cancelLabel="Cancel"
        onClose={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: "Delete" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Bestätigen" })).toBeNull();
  });
});

describe("Dialog accessible name", () => {
  it("names the dialog after its title via aria-labelledby", () => {
    render(
      <Dialog
        open
        variant="confirm"
        title="Remove Ada Lovelace from Platform Operations?"
        description="She will lose access."
        onClose={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );
    const dialog = screen.getByRole("dialog", { name: "Remove Ada Lovelace from Platform Operations?" });
    const labelId = dialog.getAttribute("aria-labelledby");
    expect(labelId).toBeTruthy();
    expect(dialog.ownerDocument.getElementById(labelId as string))?.toHaveTextContent(
      "Remove Ada Lovelace from Platform Operations?",
    );
  });

  it("describes the dialog with the body via aria-describedby when a description exists", () => {
    render(
      <Dialog
        open
        variant="confirm"
        title="Sure?"
        description="She will lose access."
        onClose={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );
    const dialog = screen.getByRole("dialog", { description: "She will lose access." });
    const descId = dialog.getAttribute("aria-describedby");
    expect(descId).toBeTruthy();
    expect(dialog.ownerDocument.getElementById(descId as string))?.toHaveTextContent("She will lose access.");
  });

  it("omits aria-describedby when there is no description", () => {
    render(<Dialog open variant="confirm" title="Sure?" onClose={vi.fn()} onConfirm={vi.fn()} />);
    expect(screen.getByRole("dialog").getAttribute("aria-describedby")).toBeNull();
  });

  it("gives simultaneous dialogs distinct label ids", () => {
    render(
      <>
        <Dialog open variant="confirm" title="First" onClose={vi.fn()} onConfirm={vi.fn()} />
        <Dialog open variant="confirm" title="Second" onClose={vi.fn()} onConfirm={vi.fn()} />
      </>,
    );
    const [a, b] = screen.getAllByRole("dialog");
    expect(a.getAttribute("aria-labelledby")).not.toBeNull();
    expect(a.getAttribute("aria-labelledby")).not.toBe(b.getAttribute("aria-labelledby"));
  });
});

describe("useDialog hook confirm labels", () => {
  function Harness() {
    const { confirm, dialogProps } = useDialog();
    useEffect(() => {
      void confirm("Remove member?", "Body text.", { confirmLabel: "Remove", cancelLabel: "Dismiss" });
    }, [confirm]);
    return <Dialog {...dialogProps} />;
  }

  it("passes confirmLabel and cancelLabel through to the rendered dialog", () => {
    render(<Harness />);
    const dialog = screen.getByRole("dialog", { name: "Remove member?" });
    expect(screen.getByRole("button", { name: "Remove" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Dismiss" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Bestätigen" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Abbrechen" })).toBeNull();
    expect(dialog).toBeInTheDocument();
  });

  it("keeps the German defaults when no labels are given", () => {
    function Plain() {
      const { confirm, dialogProps } = useDialog();
      useEffect(() => {
        void confirm("Sure?");
      }, [confirm]);
      return <Dialog {...dialogProps} />;
    }
    render(<Plain />);
    expect(screen.getByRole("dialog", { name: "Sure?" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Bestätigen" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Abbrechen" })).toBeInTheDocument();
  });
});
