import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { Select } from "@/components/ui/select";

// jsdom has no layout engine and no scrollIntoView; the component calls it to
// keep the highlighted option visible.
beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => cleanup());

const OPTIONS = [
  { value: "a", label: "Alpha" },
  { value: "b", label: "Bravo", disabled: true },
  { value: "c", label: "Charlie" },
  { value: "d", label: "Delta" },
];

function renderSelect(props: Partial<React.ComponentProps<typeof Select>> = {}) {
  const onChange = vi.fn();
  render(
    <Select
      aria-label="Letter"
      options={OPTIONS}
      value="a"
      onChange={onChange}
      {...props}
    />,
  );
  return { onChange, trigger: screen.getByRole("combobox", { name: props["aria-label"] ?? "Letter" }) };
}

function activeDescendant(trigger: HTMLElement) {
  return trigger.getAttribute("aria-activedescendant");
}

describe("Select combobox semantics", () => {
  it("exposes the trigger as a combobox that pops up a listbox", () => {
    const { trigger } = renderSelect();
    expect(trigger).toHaveAttribute("role", "combobox");
    expect(trigger).toHaveAttribute("aria-haspopup", "listbox");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("button", { name: "Letter" })).toBeNull();
  });

  it("points aria-controls at the listbox only while it exists", () => {
    const { trigger } = renderSelect();
    expect(trigger).not.toHaveAttribute("aria-controls");
    fireEvent.keyDown(trigger, { key: "Enter" });
    const listbox = screen.getByRole("listbox");
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(trigger.getAttribute("aria-controls")).toBe(listbox.id);
    expect(document.getElementById(listbox.id)).toBe(listbox);
  });

  it("has no active descendant while closed", () => {
    const { trigger } = renderSelect();
    expect(activeDescendant(trigger)).toBeNull();
  });

  it("starts on the selected option and follows ArrowDown and ArrowUp", () => {
    const { trigger } = renderSelect();
    fireEvent.keyDown(trigger, { key: "Enter" });
    const listbox = screen.getByRole("listbox");
    const idOf = (name: string) => within(listbox).getByRole("option", { name }).id;

    expect(activeDescendant(trigger)).toBe(idOf("Alpha"));
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    expect(activeDescendant(trigger)).toBe(idOf("Charlie"));
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    expect(activeDescendant(trigger)).toBe(idOf("Delta"));
    fireEvent.keyDown(trigger, { key: "ArrowUp" });
    expect(activeDescendant(trigger)).toBe(idOf("Charlie"));
    // The pointed-at element is inside the listbox and is the one that is marked.
    expect(listbox.contains(document.getElementById(activeDescendant(trigger) ?? ""))).toBe(true);
  });

  it("skips disabled options", () => {
    const { trigger } = renderSelect();
    fireEvent.keyDown(trigger, { key: "Enter" });
    const bravo = within(screen.getByRole("listbox")).getByRole("option", { name: "Bravo" });
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    expect(activeDescendant(trigger)).not.toBe(bravo.id);
    fireEvent.keyDown(trigger, { key: "ArrowUp" });
    expect(activeDescendant(trigger)).not.toBe(bravo.id);
  });

  it("gives every option a distinct id derived from the listbox id", () => {
    const { trigger } = renderSelect();
    fireEvent.keyDown(trigger, { key: "Enter" });
    const listbox = screen.getByRole("listbox");
    const ids = within(listbox).getAllByRole("option").map((option) => option.id);
    expect(ids).toEqual(OPTIONS.map((_, index) => `${listbox.id}-opt-${index}`));
    expect(new Set(ids).size).toBe(OPTIONS.length);
  });

  it("keeps options out of the tab order", () => {
    const { trigger } = renderSelect();
    fireEvent.keyDown(trigger, { key: "Enter" });
    for (const option of within(screen.getByRole("listbox")).getAllByRole("option")) {
      expect(option).toHaveAttribute("tabindex", "-1");
    }
  });

  it("commits the active option on Enter and drops the active descendant", () => {
    const { onChange, trigger } = renderSelect();
    fireEvent.keyDown(trigger, { key: "Enter" });
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    fireEvent.keyDown(trigger, { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith("c");
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(activeDescendant(trigger)).toBeNull();
  });

  it("closes on Escape without committing", () => {
    const { onChange, trigger } = renderSelect();
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    fireEvent.keyDown(trigger, { key: "Escape" });
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
    expect(activeDescendant(trigger)).toBeNull();
  });

  it("moves the highlight with the pointer", () => {
    const { trigger } = renderSelect();
    fireEvent.keyDown(trigger, { key: "Enter" });
    const delta = within(screen.getByRole("listbox")).getByRole("option", { name: "Delta" });
    fireEvent.mouseEnter(delta);
    expect(activeDescendant(trigger)).toBe(delta.id);
  });

  it("has no active descendant when there are no options", () => {
    const { trigger } = renderSelect({ options: [] });
    fireEvent.keyDown(trigger, { key: "Enter" });
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    expect(activeDescendant(trigger)).toBeNull();
  });
});

describe("Select accessible name", () => {
  it("passes aria-label to the trigger", () => {
    const { trigger } = renderSelect({ "aria-label": "Sort order" });
    expect(trigger).toHaveAttribute("aria-label", "Sort order");
  });

  it("passes aria-labelledby to the trigger", () => {
    render(
      <>
        <span id="lbl">Rows per page</span>
        <Select aria-labelledby="lbl" options={OPTIONS} value="a" onChange={() => {}} />
      </>,
    );
    expect(screen.getByRole("combobox", { name: "Rows per page" })).toBeInTheDocument();
  });

  it("names the listbox like the trigger", () => {
    const { trigger } = renderSelect({ "aria-label": "Sort order" });
    fireEvent.keyDown(trigger, { key: "Enter" });
    expect(screen.getByRole("listbox", { name: "Sort order" })).toBeInTheDocument();
  });

  it("falls back to the trigger as the listbox label when no label prop is given", () => {
    render(
      <>
        <label htmlFor="sel">Level</label>
        <Select id="sel" options={OPTIONS} value="a" onChange={() => {}} />
      </>,
    );
    const trigger = screen.getByRole("combobox", { name: "Level" });
    fireEvent.keyDown(trigger, { key: "Enter" });
    expect(screen.getByRole("listbox")).toHaveAttribute("aria-labelledby", "sel");
  });

  it("takes its name from an associated label", () => {
    render(
      <label>
        Rows
        <Select options={OPTIONS} value="a" onChange={() => {}} />
      </label>,
    );
    expect(screen.getByRole("combobox", { name: /Rows/ })).toBeInTheDocument();
  });

  it("does not open or navigate while disabled", () => {
    const { trigger } = renderSelect({ disabled: true });
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    expect(screen.queryByRole("listbox")).toBeNull();
  });
});
