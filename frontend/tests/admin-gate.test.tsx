import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { SessionUser } from "@/types";

// The admin page end to end through the real guard: only the session cookie
// reader, the API client and the redirect are replaced. The cookie user is
// what the browser sent; the API client's getCurrentUser is what the backend
// says.

class RedirectError extends Error {
  constructor(public url: string) {
    super(`NEXT_REDIRECT:${url}`);
  }
}

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  getCurrentUser: vi.fn(),
  getAdminUsers: vi.fn(),
  getAdminTeams: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new RedirectError(url);
  }),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("@/lib/auth/session", () => ({ getSession: mocks.getSession }));
vi.mock("@/lib/api/client", () => ({
  BROWSER_SESSION: { via: "proxy" },
  getCurrentUser: mocks.getCurrentUser,
  getAdminUsers: mocks.getAdminUsers,
  getAdminTeams: mocks.getAdminTeams,
  getTeams: vi.fn(),
}));
vi.mock("@/components/admin/user-table", () => ({ UserTable: () => <p>user table</p> }));

import AdminPage from "@/app/(dashboard)/admin/page";
import { AuthedShell } from "@/components/dashboard/authed-shell";

const plain: SessionUser = { id: "u1", email: "u@example.test", name: "Plain", role: "USER", status: "ACTIVE" };
const admin: SessionUser = { ...plain, id: "u2", name: "Real Admin", role: "ADMIN" };
const forged: SessionUser = { ...plain, role: "ADMIN" };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getAdminUsers.mockResolvedValue({ users: [] });
  mocks.getAdminTeams.mockResolvedValue({ teams: [] });
});

afterEach(cleanup);

describe("the admin page", () => {
  it("redirects a forged ADMIN cookie to / and asks the API for nothing", async () => {
    mocks.getSession.mockResolvedValue({ token: "tok-plain", user: forged });
    mocks.getCurrentUser.mockResolvedValue({ user: plain });

    await expect(AdminPage()).rejects.toThrow("NEXT_REDIRECT:/");
    expect(mocks.getAdminUsers).not.toHaveBeenCalled();
    expect(mocks.getAdminTeams).not.toHaveBeenCalled();
  });

  it("renders for a real admin", async () => {
    mocks.getSession.mockResolvedValue({ token: "tok-admin", user: admin });
    mocks.getCurrentUser.mockResolvedValue({ user: admin });

    render(await AdminPage());

    expect(screen.getByText("User management")).toBeTruthy();
    expect(screen.getByText("user table")).toBeTruthy();
    expect(mocks.getAdminUsers).toHaveBeenCalledWith("tok-admin");
  });

  it("renders for a real admin whose cookie says USER", async () => {
    mocks.getSession.mockResolvedValue({ token: "tok-admin", user: plain });
    mocks.getCurrentUser.mockResolvedValue({ user: admin });

    render(await AdminPage());

    expect(screen.getByText("User management")).toBeTruthy();
  });

  it("redirects to /login without a session", async () => {
    mocks.getSession.mockResolvedValue(null);

    await expect(AdminPage()).rejects.toThrow("NEXT_REDIRECT:/login");
  });
});

describe("the shell's user, which decides whether the Admin link shows", () => {
  async function shellUser() {
    const element = await AuthedShell({ children: null });
    return (element.props as { user: SessionUser | null }).user;
  }

  it("takes the role from the backend: a forged ADMIN cookie shows the plain-user navigation", async () => {
    mocks.getSession.mockResolvedValue({ token: "tok-plain", user: forged });
    mocks.getCurrentUser.mockResolvedValue({ user: plain });

    expect(await shellUser()).toEqual({ ...forged, role: "USER" });
  });

  it("shows the Admin navigation to a real admin, with the name from the cookie", async () => {
    mocks.getSession.mockResolvedValue({ token: "tok-admin", user: { ...admin, name: "Cookie Name" } });
    mocks.getCurrentUser.mockResolvedValue({ user: admin });

    expect(await shellUser()).toEqual({ ...admin, name: "Cookie Name", role: "ADMIN" });
  });

  it("falls back to the plain-user navigation when the backend cannot confirm the user", async () => {
    mocks.getSession.mockResolvedValue({ token: "tok-admin", user: admin });
    mocks.getCurrentUser.mockRejectedValue(new Error("API request failed: 502"));

    expect((await shellUser())?.role).toBe("USER");
  });

  it("has no user without a session, and does not ask the backend", async () => {
    mocks.getSession.mockResolvedValue(null);

    expect(await shellUser()).toBeNull();
    expect(mocks.getCurrentUser).not.toHaveBeenCalled();
  });
});
