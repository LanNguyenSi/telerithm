import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

vi.mock("@/lib/auth/actions", () => ({
  loginAction: vi.fn(),
  registerAction: vi.fn(),
  logoutAction: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}));

import { LoginForm } from "@/components/auth/login-form";
import { RegisterForm } from "@/components/auth/register-form";
import { AppShell } from "@/components/dashboard/app-shell";

afterEach(() => cleanup());

/**
 * The auth pages are outside the app shell, so each form owns the page's only
 * main landmark (axe landmark-one-main and region); the dashboard keeps the
 * single main the app shell already renders.
 */
describe("main landmark", () => {
  it("puts the login form in exactly one main landmark", () => {
    render(<LoginForm registrationMode="open" />);
    expect(screen.getAllByRole("main")).toHaveLength(1);
    expect(screen.getByRole("heading", { level: 1 })).toHaveAccessibleName("Sign in");
  });

  it("puts the register form in exactly one main landmark", () => {
    render(<RegisterForm registrationMode="open" />);
    expect(screen.getAllByRole("main")).toHaveLength(1);
    expect(screen.getByRole("heading", { level: 1 })).toHaveAccessibleName("Create account");
  });

  it("keeps the register approval notice inside the same main landmark", () => {
    render(<RegisterForm registrationMode="approval" />);
    expect(screen.getAllByRole("main")).toHaveLength(1);
  });

  it("keeps the app shell at exactly one main that wraps the page", () => {
    render(
      <AppShell>
        <p>page body</p>
      </AppShell>,
    );
    const mains = screen.getAllByRole("main");
    expect(mains).toHaveLength(1);
    expect(mains[0]).toHaveTextContent("page body");
  });
});
