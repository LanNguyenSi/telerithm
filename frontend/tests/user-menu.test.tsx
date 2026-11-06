import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Sidebar } from "@/components/dashboard/sidebar";
import type { SessionUser } from "@/types";

vi.mock("next/navigation", () => ({ usePathname: () => "/" }));
vi.mock("@/lib/auth/actions", () => ({ logoutAction: vi.fn() }));

const admin = { name: "Demo Admin", role: "ADMIN" } as unknown as SessionUser;

afterEach(() => cleanup());

function triggers() {
  return screen.getAllByRole("button", { name: /Demo Admin/ });
}

function desktopTrigger() {
  return triggers()[0];
}

function popover(trigger: HTMLElement) {
  return document.getElementById(trigger.getAttribute("aria-controls") ?? "");
}

describe("UserMenu trigger and popover", () => {
  it("reports the closed and open state and points aria-controls at the popover", () => {
    render(<Sidebar user={admin} />);
    const trigger = desktopTrigger();
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(trigger.getAttribute("aria-haspopup")).toBe("true");
    expect(trigger.getAttribute("aria-controls")).toBeTruthy();
    expect(popover(trigger)).toBeNull();

    fireEvent.click(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    const pop = popover(trigger);
    expect(pop).not.toBeNull();
    expect(pop?.textContent).toContain("Sign out");
    expect(pop?.querySelector("a")?.getAttribute("href")).toBe("/settings");
  });

  it("closes on Escape and moves focus to the trigger", () => {
    render(<Sidebar user={admin} />);
    const trigger = desktopTrigger();
    fireEvent.click(trigger);
    screen.getByRole("link", { name: "Settings" }).focus();

    fireEvent.keyDown(document.activeElement ?? document, { key: "Escape" });
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(popover(trigger)).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("ignores other keys while open", () => {
    render(<Sidebar user={admin} />);
    const trigger = desktopTrigger();
    fireEvent.click(trigger);
    fireEvent.keyDown(document, { key: "a" });
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
  });

  it("does not take Escape while closed", () => {
    render(<Sidebar user={admin} />);
    expect(fireEvent.keyDown(document, { key: "Escape" })).toBe(true);
    expect(document.activeElement).toBe(document.body);
  });

  it("still closes on a mousedown outside and stays open on one inside", () => {
    render(<Sidebar user={admin} />);
    const trigger = desktopTrigger();
    fireEvent.click(trigger);
    fireEvent.mouseDown(popover(trigger)!);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    fireEvent.mouseDown(document.body);
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
  });

  it("gives the desktop and drawer instances different ids", () => {
    render(<Sidebar user={admin} />);
    fireEvent.click(screen.getByRole("button", { name: "Toggle navigation" }));
    const [desktop, drawer] = triggers();
    expect(triggers().length).toBe(2);
    const a = desktop.getAttribute("aria-controls");
    const b = drawer.getAttribute("aria-controls");
    expect(a).toBeTruthy();
    expect(b).toBeTruthy();
    expect(a).not.toBe(b);
  });
});

describe("UserMenu inside the mobile drawer", () => {
  function openDrawer() {
    const toggle = screen.getByRole("button", { name: "Toggle navigation" });
    toggle.focus();
    fireEvent.click(toggle);
    return screen.getByRole("dialog", { name: "Navigation menu" });
  }

  it("closes only the menu on the first Escape and the drawer on the second", () => {
    render(<Sidebar user={admin} />);
    const dialog = openDrawer();
    const trigger = Array.from(dialog.querySelectorAll<HTMLElement>("button")).find((b) =>
      b.textContent?.includes("Demo Admin"),
    )!;
    fireEvent.click(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");

    fireEvent.keyDown(document, { key: "Escape" });
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("dialog", { name: "Navigation menu" })).not.toBeNull();
    expect(document.activeElement).toBe(trigger);

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Navigation menu" })).toBeNull();
  });
});
