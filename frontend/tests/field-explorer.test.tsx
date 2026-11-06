import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { FieldExplorer } from "@/components/logs/field-explorer";

afterEach(() => cleanup());

const fields = [{ key: "env", hits: 5, topValues: ["prod", "staging"] }];

describe("FieldExplorer: chip target size (WCAG 2.5.8)", () => {
  it("gives the value chips the min-h-6 sizing class instead of py-0.5", () => {
    render(
      <FieldExplorer
        fields={fields}
        selectedColumns={[]}
        onAddColumn={vi.fn()}
        onAddFilter={vi.fn()}
      />,
    );
    const chips = [screen.getByRole("button", { name: "prod" }), screen.getByRole("button", { name: "staging" })];
    for (const chip of chips) {
      expect(chip.className).toContain("min-h-6");
      expect(chip.className).not.toContain("py-0.5");
    }
  });

  it("gives the Add as column button the min-h-6 sizing class instead of py-0.5", () => {
    render(
      <FieldExplorer
        fields={fields}
        selectedColumns={[]}
        onAddColumn={vi.fn()}
        onAddFilter={vi.fn()}
      />,
    );
    const addColumn = screen.getByRole("button", { name: "Add as column" });
    expect(addColumn.className).toContain("min-h-6");
    expect(addColumn.className).not.toContain("py-0.5");
  });

  it("keeps the min-h-6 sizing class when the column is already added", () => {
    render(
      <FieldExplorer
        fields={fields}
        selectedColumns={["env"]}
        onAddColumn={vi.fn()}
        onAddFilter={vi.fn()}
      />,
    );
    const added = screen.getByRole("button", { name: "Column added" });
    expect(added.className).toContain("min-h-6");
    expect(added).toBeDisabled();
  });
});
