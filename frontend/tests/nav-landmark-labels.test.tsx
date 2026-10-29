import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { SessionUser } from "@/types";

let pathname = "/logs";

vi.mock("next/navigation", () => ({
  usePathname: () => pathname,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}));

vi.mock("@/lib/auth/actions", () => ({ logoutAction: vi.fn() }));

import { Sidebar } from "@/components/dashboard/sidebar";
import { LogsTabNav } from "@/components/logs/logs-tab-nav";

const user = { id: "u1", name: "Demo", email: "demo@example.com", role: "ADMIN" } as SessionUser;

afterEach(() => {
  cleanup();
  pathname = "/logs";
});

/**
 * A dashboard page carries two navs (app sidebar plus the logs tabs), so each
 * needs its own accessible name and the back control on a log detail page is
 * not navigation at all (axe landmark-unique).
 */
describe("navigation landmark names", () => {
  it("labels the app sidebar navigation Main", () => {
    pathname = "/";
    render(<Sidebar user={user} />);
    const navs = screen.getAllByRole("navigation");
    expect(navs).toHaveLength(1);
    expect(navs[0]).toHaveAccessibleName("Main");
  });

  it("labels the logs section tabs Logs sections", () => {
    pathname = "/logs";
    render(<LogsTabNav />);
    const navs = screen.getAllByRole("navigation");
    expect(navs).toHaveLength(1);
    expect(navs[0]).toHaveAccessibleName("Logs sections");
  });

  it("does not use a navigation landmark for the single back control on a log detail page", () => {
    pathname = "/logs/l1";
    render(<LogsTabNav />);
    expect(screen.queryByRole("navigation")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
  });
});
