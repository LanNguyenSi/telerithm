import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import { Dialog } from "@/components/ui/dialog";

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
