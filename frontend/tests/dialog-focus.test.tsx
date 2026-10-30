import { afterEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { Dialog, useDialog } from "@/components/ui/dialog";

afterEach(cleanup);

/** A page with an opener button, wired the way the real consumers wire useDialog. */
function ConfirmHarness({ removeOpenerOnConfirm = false }: { removeOpenerOnConfirm?: boolean }) {
  const { confirm, dialogProps } = useDialog();
  const [gone, setGone] = useState(false);
  return (
    <div>
      {gone ? null : (
        <button
          type="button"
          onClick={async () => {
            const ok = await confirm("Remove Ada?", "She will lose access.");
            if (ok && removeOpenerOnConfirm) setGone(true);
          }}
        >
          Remove
        </button>
      )}
      <button type="button">Other</button>
      <Dialog {...dialogProps} />
    </div>
  );
}

function PromptHarness() {
  const { prompt, saveView, dialogProps } = useDialog();
  return (
    <div>
      <button type="button" onClick={() => void prompt("Name", "start")}>
        Rename
      </button>
      <button type="button" onClick={() => void saveView("Save", "view", { canManageShared: true })}>
        Save view
      </button>
      <Dialog {...dialogProps} />
    </div>
  );
}

function openFrom(name: string) {
  const opener = screen.getByRole("button", { name });
  opener.focus();
  fireEvent.click(opener);
  return opener;
}

function dialogEl() {
  return screen.queryByRole("dialog");
}

describe("Dialog focus on open", () => {
  it("focuses the Cancel button of the confirm variant", async () => {
    render(<ConfirmHarness />);
    openFrom("Remove");
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Abbrechen" }));
  });

  it("keeps the input focus of the prompt variant", () => {
    render(<PromptHarness />);
    openFrom("Rename");
    const input = screen.getByRole("textbox") as HTMLInputElement;
    expect(document.activeElement).toBe(input);
    expect(input.value).toBe("start");
  });

  it("keeps the input focus of the save-view variant", () => {
    render(<PromptHarness />);
    openFrom("Save view");
    expect(document.activeElement).toBe(screen.getByPlaceholderText("Name der Ansicht"));
  });
});

describe("Dialog focus restore on close", () => {
  async function opened() {
    render(<ConfirmHarness />);
    const opener = openFrom("Remove");
    await screen.findByRole("dialog");
    // Focus is inside the dialog now, not on the opener.
    expect(document.activeElement).not.toBe(opener);
    return opener;
  }

  it("returns focus to the opener on Cancel", async () => {
    const opener = await opened();
    fireEvent.click(screen.getByRole("button", { name: "Abbrechen" }));
    expect(dialogEl()).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it("returns focus to the opener on Confirm", async () => {
    const opener = await opened();
    fireEvent.click(screen.getByRole("button", { name: "Bestätigen" }));
    expect(dialogEl()).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it("returns focus to the opener on Escape", async () => {
    const opener = await opened();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(dialogEl()).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it("returns focus to the opener on a backdrop click", async () => {
    const opener = await opened();
    const backdrop = screen.getByRole("dialog").parentElement as HTMLElement;
    fireEvent.click(backdrop);
    expect(dialogEl()).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it("does not close or move focus on a click inside the dialog panel", async () => {
    await opened();
    fireEvent.click(screen.getByRole("dialog"));
    expect(dialogEl()).not.toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Abbrechen" }));
  });

  it("restores focus to the prompt opener after Enter confirms", () => {
    render(<PromptHarness />);
    const opener = openFrom("Rename");
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });
    expect(dialogEl()).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it("skips the restore when the opener left the document while the dialog was open", () => {
    const tree = (withOpener: boolean, open: boolean) => (
      <div>
        {withOpener ? <button type="button">Opener</button> : null}
        <Dialog open={open} variant="confirm" title="Sure?" onClose={vi.fn()} onConfirm={vi.fn()} />
      </div>
    );
    const { rerender } = render(tree(true, false));
    const opener = screen.getByRole("button", { name: "Opener" });
    opener.focus();
    rerender(tree(true, true));
    const focusSpy = vi.spyOn(opener, "focus");
    rerender(tree(false, true));
    expect(opener.isConnected).toBe(false);
    rerender(tree(false, false));
    expect(dialogEl()).toBeNull();
    expect(focusSpy).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(document.body);
  });

  it("moves focus to the captured ancestor when the opener is removed after Confirm", async () => {
    render(<ConfirmHarness removeOpenerOnConfirm />);
    const opener = openFrom("Remove");
    await screen.findByRole("dialog");
    const ancestor = opener.parentElement as HTMLElement;
    fireEvent.click(screen.getByRole("button", { name: "Bestätigen" }));
    await act(async () => {});
    expect(dialogEl()).toBeNull();
    expect(opener.isConnected).toBe(false);
    await waitFor(() => expect(document.activeElement).toBe(ancestor));
    expect(ancestor.getAttribute("tabindex")).toBe("-1");
  });

  it("restores when the open prop turns false without unmounting", () => {
    const { rerender } = render(
      <div>
        <button type="button">Opener</button>
        <Dialog open={false} variant="confirm" title="Sure?" onClose={vi.fn()} onConfirm={vi.fn()} />
      </div>,
    );
    const opener = screen.getByRole("button", { name: "Opener" });
    opener.focus();
    rerender(
      <div>
        <button type="button">Opener</button>
        <Dialog open variant="confirm" title="Sure?" onClose={vi.fn()} onConfirm={vi.fn()} />
      </div>,
    );
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Abbrechen" }));
    rerender(
      <div>
        <button type="button">Opener</button>
        <Dialog open={false} variant="confirm" title="Sure?" onClose={vi.fn()} onConfirm={vi.fn()} />
      </div>,
    );
    expect(document.activeElement).toBe(opener);
  });

  it("does not move focus when only onClose changes identity while open", () => {
    const tree = (onClose: () => void) => (
      <div>
        <button type="button">Opener</button>
        <Dialog open variant="confirm" title="Sure?" onClose={onClose} onConfirm={vi.fn()} />
      </div>
    );
    const { rerender } = render(tree(vi.fn()));
    const confirmBtn = screen.getByRole("button", { name: "Bestätigen" });
    confirmBtn.focus();
    rerender(tree(vi.fn()));
    rerender(tree(vi.fn()));
    expect(document.activeElement).toBe(confirmBtn);
  });
});

describe("Dialog Tab trap", () => {
  async function opened() {
    render(<ConfirmHarness />);
    openFrom("Remove");
    await screen.findByRole("dialog");
    return {
      cancel: screen.getByRole("button", { name: "Abbrechen" }),
      confirm: screen.getByRole("button", { name: "Bestätigen" }),
    };
  }

  it("wraps Tab from the last button to the first", async () => {
    const { cancel, confirm } = await opened();
    confirm.focus();
    expect(fireEvent.keyDown(document, { key: "Tab" })).toBe(false);
    expect(document.activeElement).toBe(cancel);
  });

  it("wraps Shift+Tab from the first button to the last", async () => {
    const { cancel, confirm } = await opened();
    cancel.focus();
    expect(fireEvent.keyDown(document, { key: "Tab", shiftKey: true })).toBe(false);
    expect(document.activeElement).toBe(confirm);
  });

  it("leaves Tab alone between the first and the last item", async () => {
    const { cancel } = await opened();
    cancel.focus();
    expect(fireEvent.keyDown(document, { key: "Tab" })).toBe(true);
  });

  it("pulls focus that sits outside back into the dialog", async () => {
    const { cancel, confirm } = await opened();
    screen.getByRole("button", { name: "Other" }).focus();
    expect(fireEvent.keyDown(document, { key: "Tab" })).toBe(false);
    expect(document.activeElement).toBe(cancel);
    screen.getByRole("button", { name: "Other" }).focus();
    expect(fireEvent.keyDown(document, { key: "Tab", shiftKey: true })).toBe(false);
    expect(document.activeElement).toBe(confirm);
  });

  it("wraps across the input, checkboxes and buttons of the save-view variant", () => {
    render(<PromptHarness />);
    openFrom("Save view");
    const input = screen.getByPlaceholderText("Name der Ansicht");
    const confirm = screen.getByRole("button", { name: "Speichern" });
    confirm.focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(document.activeElement).toBe(input);
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(confirm);
  });

  it("skips disabled checkboxes when wrapping", () => {
    render(
      <Dialog
        open
        variant="save-view"
        title="Save"
        canManageShared={false}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );
    const input = screen.getByPlaceholderText("Name der Ansicht");
    screen.getByRole("button", { name: "Speichern" }).focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(document.activeElement).toBe(input);
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Speichern" }));
  });

  it("does not intercept Tab while closed", () => {
    render(<ConfirmHarness />);
    expect(fireEvent.keyDown(document, { key: "Tab" })).toBe(true);
  });
});

/** A page whose Remove button leaves the document only when the resolved
 * confirm's state update lands, the way the real consumers remove openers. */
function LateRemovalHarness({ removeRegion = false }: { removeRegion?: boolean }) {
  const { confirm, dialogProps } = useDialog();
  const [gone, setGone] = useState(false);
  return (
    <main>
      {gone && removeRegion ? null : (
        <div data-testid="region">
          {gone ? null : (
            <button
              type="button"
              onClick={async () => {
                const ok = await confirm("Remove Ada?", "She will lose access.");
                if (ok) setGone(true);
              }}
            >
              Remove
            </button>
          )}
        </div>
      )}
      <button type="button">Other</button>
      <Dialog {...dialogProps} />
    </main>
  );
}

describe("Dialog focus when the confirmed action removes the opener later", () => {
  it("moves focus to the nearest captured ancestor once the removal lands", async () => {
    render(<LateRemovalHarness />);
    const opener = openFrom("Remove");
    await screen.findByRole("dialog");
    const region = screen.getByTestId("region");
    fireEvent.click(screen.getByRole("button", { name: "Bestätigen" }));
    expect(document.activeElement).toBe(opener);
    await waitFor(() => expect(opener.isConnected).toBe(false));
    await act(async () => {});
    expect(document.activeElement).toBe(region);
    expect(region.getAttribute("tabindex")).toBe("-1");
  });

  it("keeps focus on the opener when nothing is removed, even after later DOM changes", async () => {
    render(<ConfirmHarness />);
    const opener = openFrom("Remove");
    await screen.findByRole("dialog");
    fireEvent.click(screen.getByRole("button", { name: "Bestätigen" }));
    expect(document.activeElement).toBe(opener);
    const other = document.createElement("p");
    act(() => {
      document.body.appendChild(other);
    });
    await act(async () => {});
    expect(document.activeElement).toBe(opener);
    other.remove();
  });

  it("does not steal focus the user moved elsewhere before the removal", async () => {
    render(<LateRemovalHarness />);
    const opener = openFrom("Remove");
    await screen.findByRole("dialog");
    const region = screen.getByTestId("region");
    fireEvent.click(screen.getByRole("button", { name: "Bestätigen" }));
    const other = screen.getByRole("button", { name: "Other" });
    other.focus();
    await waitFor(() => expect(opener.isConnected).toBe(false));
    await act(async () => {});
    expect(document.activeElement).toBe(other);
    expect(region.hasAttribute("tabindex")).toBe(false);
  });

  it("falls back to the main landmark when the captured ancestors are removed too", async () => {
    render(<LateRemovalHarness removeRegion />);
    const opener = openFrom("Remove");
    await screen.findByRole("dialog");
    const main = document.querySelector("main") as HTMLElement;
    fireEvent.click(screen.getByRole("button", { name: "Bestätigen" }));
    await waitFor(() => expect(opener.isConnected).toBe(false));
    await act(async () => {});
    expect(document.activeElement).toBe(main);
    expect(main.getAttribute("tabindex")).toBe("-1");
  });

  it("leaves the new dialog's focus alone when the dialog reopens before the removal lands", async () => {
    render(<LateRemovalHarness />);
    const opener = openFrom("Remove");
    await screen.findByRole("dialog");
    fireEvent.click(screen.getByRole("button", { name: "Bestätigen" }));
    fireEvent.click(opener);
    await screen.findByRole("dialog");
    const cancel = screen.getByRole("button", { name: "Abbrechen" });
    expect(document.activeElement).toBe(cancel);
    await waitFor(() => expect(opener.isConnected).toBe(false));
    await act(async () => {});
    expect(document.activeElement).toBe(cancel);
  });

  it("ends the watcher and moves no focus when the component unmounts while it is watching", () => {
    render(<LateRemovalHarness />);
    openFrom("Remove");
    fireEvent.keyDown(document, { key: "Escape" });
    const main = document.querySelector("main") as HTMLElement;
    const disconnects = vi.spyOn(MutationObserver.prototype, "disconnect");
    cleanup();
    expect(disconnects).toHaveBeenCalled();
    disconnects.mockRestore();
    expect(main.hasAttribute("tabindex")).toBe(false);
    expect(document.activeElement).toBe(document.body);
  });

  it("leaves no watcher behind when only the dialog unmounts while it is still open", async () => {
    const observes = vi.spyOn(MutationObserver.prototype, "observe");
    const disconnects = vi.spyOn(MutationObserver.prototype, "disconnect");
    try {
      const { rerender } = render(
        <main>
          <section data-testid="host">
            <button type="button">Opener</button>
          </section>
          <Dialog open={false} variant="confirm" title="Sure?" onClose={vi.fn()} onConfirm={vi.fn()} />
        </main>,
      );
      const opener = screen.getByRole("button", { name: "Opener" });
      opener.focus();
      rerender(
        <main>
          <section data-testid="host">
            <button type="button">Opener</button>
          </section>
          <Dialog open variant="confirm" title="Sure?" onClose={vi.fn()} onConfirm={vi.fn()} />
        </main>,
      );
      // Unmount only the dialog, still open; the opener stays connected.
      rerender(
        <main>
          <section data-testid="host">
            <button type="button">Opener</button>
          </section>
        </main>,
      );
      expect(disconnects.mock.calls.length).toBeGreaterThanOrEqual(observes.mock.calls.length);
      const host = screen.getByTestId("host");
      act(() => {
        opener.remove();
      });
      await act(async () => {});
      expect(host.hasAttribute("tabindex")).toBe(false);
      expect(document.querySelector("main")?.hasAttribute("tabindex")).toBe(false);
    } finally {
      observes.mockRestore();
      disconnects.mockRestore();
    }
  });

  it("stops watching after the timeout so a late removal moves no focus", async () => {
    vi.useFakeTimers();
    try {
      render(<LateRemovalHarness />);
      const opener = openFrom("Remove");
      expect(screen.getByRole("dialog")).toBeInTheDocument();
      const region = screen.getByTestId("region");
      fireEvent.click(screen.getByRole("button", { name: "Abbrechen" }));
      expect(document.activeElement).toBe(opener);
      act(() => {
        vi.advanceTimersByTime(3001);
      });
      act(() => {
        opener.remove();
      });
      await act(async () => {});
      expect(document.activeElement).toBe(document.body);
      expect(region.hasAttribute("tabindex")).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});
