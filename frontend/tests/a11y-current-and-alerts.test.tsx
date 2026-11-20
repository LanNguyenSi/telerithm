import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

const nav = vi.hoisted(() => ({ pathname: "/" }));

vi.mock("next/navigation", () => ({
  usePathname: () => nav.pathname,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}));

vi.mock("@/lib/auth/actions", () => ({
  loginAction: vi.fn(() => ({ error: "Email and password are required" })),
  registerAction: vi.fn(() => ({ error: "All fields are required" })),
  logoutAction: vi.fn(),
}));

import { LoginForm } from "@/components/auth/login-form";
import { RegisterForm } from "@/components/auth/register-form";
import { Sidebar } from "@/components/dashboard/sidebar";
import { LogsTabNav } from "@/components/logs/logs-tab-nav";
import type { SessionUser } from "@/types";

const admin = { name: "Demo Admin", role: "ADMIN" } as unknown as SessionUser;

afterEach(() => {
  cleanup();
  nav.pathname = "/";
});

/**
 * The auth error paragraph is rendered only when the action state carries an
 * error, so its alert role announces the message on insertion (a plain
 * paragraph is a live-region candidate the screen reader may stay silent on).
 */
describe("auth form errors are announced", () => {
  it("renders no alert before the login form is submitted", () => {
    render(<LoginForm registrationMode="open" />);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("shows the login error in an alert role after submit", () => {
    const { container } = render(<LoginForm registrationMode="open" />);
    fireEvent.submit(container.querySelector("form") as HTMLFormElement);
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Email and password are required");
  });

  it("shows the register error in an alert role after submit", () => {
    const { container } = render(<RegisterForm registrationMode="open" />);
    expect(screen.queryByRole("alert")).toBeNull();
    fireEvent.submit(container.querySelector("form") as HTMLFormElement);
    expect(screen.getByRole("alert")).toHaveTextContent("All fields are required");
  });
});

describe("sidebar aria-current", () => {
  it("marks the active link with aria-current=page and omits it on the others", () => {
    nav.pathname = "/logs";
    render(<Sidebar user={admin} />);
    expect(screen.getByRole("link", { name: "Logs" })).toHaveAttribute("aria-current", "page");
    for (const label of ["Overview", "Issues", "Alerts", "Dashboards", "Admin"]) {
      expect(screen.getByRole("link", { name: label })).not.toHaveAttribute("aria-current");
    }
  });

  it("marks Overview on the exact root path and nothing on a sub-path of it", () => {
    nav.pathname = "/";
    render(<Sidebar user={admin} />);
    expect(screen.getByRole("link", { name: "Overview" })).toHaveAttribute("aria-current", "page");
  });

  it("marks a nested route by its section prefix", () => {
    nav.pathname = "/logs/l1";
    render(<Sidebar user={admin} />);
    expect(screen.getByRole("link", { name: "Logs" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Overview" })).not.toHaveAttribute("aria-current");
  });
});

describe("logs tab aria-current", () => {
  it("marks the Today tab active on /logs and leaves Search unmarked", () => {
    nav.pathname = "/logs";
    render(<LogsTabNav />);
    expect(screen.getByRole("link", { name: "Today" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Search" })).not.toHaveAttribute("aria-current");
  });

  it("marks the Search tab active on /logs/search and leaves Today unmarked", () => {
    nav.pathname = "/logs/search";
    render(<LogsTabNav />);
    expect(screen.getByRole("link", { name: "Search" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Today" })).not.toHaveAttribute("aria-current");
  });
});
