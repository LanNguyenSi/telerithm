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

  it("stops an Escape aimed at the menu so no other listener sees it", () => {
    render(<Sidebar user={admin} />);
    const trigger = desktopTrigger();
    fireEvent.click(trigger);
    const spy = vi.fn();
    document.addEventListener("keydown", spy);
    try {
      fireEvent.keyDown(popover(trigger)!, { key: "Escape" });
    } finally {
      document.removeEventListener("keydown", spy);
    }
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(spy).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(trigger);
  });

  it("handles an Escape from the sidebar nav containing the menu without passing it on", () => {
    render(<Sidebar user={admin} />);
    const trigger = desktopTrigger();
    fireEvent.click(trigger);
    const navLink = screen.getByRole("link", { name: "Logs" });
    navLink.focus();
    const spy = vi.fn();
    document.addEventListener("keydown", spy);
    try {
      fireEvent.keyDown(navLink, { key: "Escape" });
    } finally {
      document.removeEventListener("keydown", spy);
    }
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(spy).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(trigger);
  });

  it("closes on an Escape from elsewhere and lets it reach other document listeners", () => {
    render(<Sidebar user={admin} />);
    const trigger = desktopTrigger();
    fireEvent.click(trigger);
    const spy = vi.fn();
    document.addEventListener("keydown", spy);
    try {
      fireEvent.keyDown(document.body, { key: "Escape" });
    } finally {
      document.removeEventListener("keydown", spy);
    }
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(spy).toHaveBeenCalledTimes(1);
    // Focus stays where the Escape came from: the menu only returns it to the
    // trigger when it handled the key.
    expect(document.activeElement).not.toBe(trigger);
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

    // The Escape comes from inside the open menu (focus sits on the trigger or
    // a menu item), so the menu handles it and stops it: the drawer stays open.
    fireEvent.keyDown(trigger, { key: "Escape" });
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("dialog", { name: "Navigation menu" })).not.toBeNull();
    expect(document.activeElement).toBe(trigger);

    fireEvent.keyDown(trigger, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Navigation menu" })).toBeNull();
  });
});
