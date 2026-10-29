import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Sidebar } from "@/components/dashboard/sidebar";
import type { SessionUser } from "@/types";

vi.mock("next/navigation", () => ({ usePathname: () => "/" }));
vi.mock("@/lib/auth/actions", () => ({ logoutAction: vi.fn() }));

const admin = { name: "Demo Admin", role: "ADMIN" } as unknown as SessionUser;

function toggle() {
  return screen.getByRole("button", { name: "Toggle navigation" });
}

function drawer() {
  return screen.queryByRole("dialog", { name: "Navigation menu" });
}

function open() {
  toggle().focus();
  fireEvent.click(toggle());
  return drawer() as HTMLElement;
}

function drawerLinks(el: HTMLElement) {
  return Array.from(el.querySelectorAll<HTMLElement>("a[href], button"));
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Sidebar mobile drawer", () => {
  beforeEach(() => {
    render(<Sidebar user={admin} />);
  });

  it("reports the closed and open state on the toggle and points it at the drawer", () => {
    expect(toggle().getAttribute("aria-expanded")).toBe("false");
    expect(toggle().getAttribute("aria-controls")).toBe("mobile-nav-drawer");
    expect(drawer()).toBeNull();

    const el = open();
    expect(toggle().getAttribute("aria-expanded")).toBe("true");
    expect(el.id).toBe("mobile-nav-drawer");
    expect(el.getAttribute("aria-modal")).toBe("true");
  });

  it("moves focus into the drawer on open", () => {
    const el = open();
    expect(el.contains(document.activeElement)).toBe(true);
    expect(document.activeElement?.textContent).toContain("Overview");
  });

  it("closes on Escape and returns focus to the toggle", () => {
    open();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(drawer()).toBeNull();
    expect(toggle().getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(toggle());
  });

  it("closes on an overlay click and returns focus to the toggle", () => {
    open();
    const overlay = document.querySelector<HTMLElement>(".bg-black\\/50");
    expect(overlay).not.toBeNull();
    fireEvent.click(overlay!);
    expect(drawer()).toBeNull();
    expect(document.activeElement).toBe(toggle());
  });

  it("closes when a link is chosen and does not pull focus back to the toggle", () => {
    const el = open();
    const logs = Array.from(el.querySelectorAll("a")).find((a) => a.textContent?.includes("Logs"))!;
    logs.addEventListener("click", (e) => e.preventDefault());
    fireEvent.click(logs);
    expect(drawer()).toBeNull();
    expect(document.activeElement).not.toBe(toggle());
  });

  it("wraps Tab from the last item to the first and Shift+Tab from the first to the last", () => {
    const el = open();
    const items = drawerLinks(el);
    const first = items[0];
    const last = items[items.length - 1];

    last.focus();
    expect(fireEvent.keyDown(document, { key: "Tab" })).toBe(false);
    expect(document.activeElement).toBe(first);

    expect(fireEvent.keyDown(document, { key: "Tab", shiftKey: true })).toBe(false);
    expect(document.activeElement).toBe(last);
  });

  it("leaves Tab alone in the middle of the drawer", () => {
    const el = open();
    drawerLinks(el)[1].focus();
    expect(fireEvent.keyDown(document, { key: "Tab" })).toBe(true);
  });

  it("pulls focus back into the drawer when it sits outside", () => {
    const el = open();
    toggle().focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(document.activeElement).toBe(drawerLinks(el)[0]);
  });

  it("does not trap or intercept keys while the drawer is closed", () => {
    expect(fireEvent.keyDown(document, { key: "Tab" })).toBe(true);
    expect(fireEvent.keyDown(document, { key: "Escape" })).toBe(true);
    expect(toggle().getAttribute("aria-expanded")).toBe("false");
  });

  it("renders no dialog, inert or modal marker in the desktop layout (drawer closed)", () => {
    expect(document.querySelector("[inert]")).toBeNull();
    expect(document.querySelector("[aria-modal]")).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
    // The always-visible desktop sidebar keeps its own navigation.
    expect(document.querySelectorAll("aside").length).toBe(1);
  });

  it("marks nothing inert when the drawer is open", () => {
    open();
    expect(document.querySelector("[inert]")).toBeNull();
  });
});

describe("Sidebar drawer and viewport growth", () => {
  it("closes the drawer when the viewport reaches the desktop breakpoint", () => {
    let listener: ((e: MediaQueryListEvent) => void) | undefined;
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({
        matches: false,
        addEventListener: (_: string, cb: (e: MediaQueryListEvent) => void) => {
          listener = cb;
        },
        removeEventListener: () => {
          listener = undefined;
        },
      })),
    );
    render(<Sidebar user={admin} />);
    open();
    expect(listener).toBeDefined();
    act(() => listener!({ matches: false } as MediaQueryListEvent));
    expect(drawer()).not.toBeNull();
    act(() => listener!({ matches: true } as MediaQueryListEvent));
    expect(drawer()).toBeNull();
  });
});
