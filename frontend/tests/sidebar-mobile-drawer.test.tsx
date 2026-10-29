import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { AppShell } from "@/components/dashboard/app-shell";
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

  it("marks the top bar and the desktop sidebar inert while the drawer is open, not the drawer or its overlay", () => {
    const el = open();
    const aside = document.querySelector("aside") as HTMLElement;
    expect(aside.hasAttribute("inert")).toBe(true);
    expect(toggle().closest("[inert]")).not.toBeNull();
    expect(el.closest("[inert]")).toBeNull();
    expect(el.hasAttribute("inert")).toBe(false);
    const overlay = document.querySelector<HTMLElement>(".bg-black\\/50") as HTMLElement;
    expect(overlay.closest("[inert]")).toBeNull();
    expect(document.querySelectorAll("[inert]").length).toBe(2);
  });

  it("restores the page on Escape", () => {
    open();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(document.querySelector("[inert]")).toBeNull();
  });

  it("restores the page on an overlay click", () => {
    open();
    fireEvent.click(document.querySelector<HTMLElement>(".bg-black\\/50")!);
    expect(document.querySelector("[inert]")).toBeNull();
  });

  it("restores the page when a link is chosen", () => {
    const el = open();
    const logs = Array.from(el.querySelectorAll("a")).find((a) => a.textContent?.includes("Logs"))!;
    logs.addEventListener("click", (e) => e.preventDefault());
    fireEvent.click(logs);
    expect(document.querySelector("[inert]")).toBeNull();
  });

  it("restores the page when the toggle closes the drawer", () => {
    open();
    fireEvent.click(toggle());
    expect(drawer()).toBeNull();
    expect(document.querySelector("[inert]")).toBeNull();
  });

  it("restores the page when the drawer unmounts while open", () => {
    open();
    cleanup();
    expect(document.querySelector("[inert]")).toBeNull();
  });

  it("returns focus to the toggle only after inert is gone", () => {
    open();
    const seen: boolean[] = [];
    const real = toggle().focus.bind(toggle());
    vi.spyOn(toggle(), "focus").mockImplementation(() => {
      seen.push(toggle().closest("[inert]") !== null);
      real();
    });
    fireEvent.keyDown(document, { key: "Escape" });
    expect(seen).toEqual([false]);
    expect(document.activeElement).toBe(toggle());
  });

  it("keeps the Tab wrap working with the page inert", () => {
    const el = open();
    const items = drawerLinks(el);
    items[items.length - 1].focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(document.activeElement).toBe(items[0]);
  });
});

describe("AppShell with the mobile drawer", () => {
  function renderShell() {
    render(
      <AppShell user={admin}>
        <button type="button">Page action</button>
      </AppShell>,
    );
    return document.querySelector("[data-app-content]") as HTMLElement;
  }

  it("marks the page content inert while the drawer is open and restores it on every close path", () => {
    const content = renderShell();
    expect(content.contains(screen.getByRole("button", { name: "Page action" }))).toBe(true);
    expect(content.hasAttribute("inert")).toBe(false);

    open();
    expect(content.hasAttribute("inert")).toBe(true);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(content.hasAttribute("inert")).toBe(false);

    open();
    expect(content.hasAttribute("inert")).toBe(true);
    fireEvent.click(document.querySelector<HTMLElement>(".bg-black\\/50")!);
    expect(content.hasAttribute("inert")).toBe(false);

    open();
    fireEvent.click(toggle());
    expect(content.hasAttribute("inert")).toBe(false);
    expect(document.querySelector("[inert]")).toBeNull();
  });

  it("restores the page content on viewport growth", () => {
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
    const content = renderShell();
    open();
    expect(content.hasAttribute("inert")).toBe(true);
    act(() => listener!({ matches: true } as MediaQueryListEvent));
    expect(content.hasAttribute("inert")).toBe(false);
    expect(document.querySelector("[inert]")).toBeNull();
  });

  it("leaves an element that was already inert alone when the drawer closes", () => {
    const content = renderShell();
    content.setAttribute("inert", "");
    open();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(content.hasAttribute("inert")).toBe(true);
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
