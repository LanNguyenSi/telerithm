import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionUser, Team } from "@/types";

class RedirectError extends Error {
  constructor(public url: string) {
    super(`NEXT_REDIRECT:${url}`);
  }
}

vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new RedirectError(url);
  }),
}));

vi.mock("@/lib/auth/session", () => ({
  getSession: vi.fn(),
}));

vi.mock("@/lib/api/client", () => ({
  getTeams: vi.fn(),
  getCurrentUser: vi.fn(),
}));

import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { getCurrentUser, getTeams } from "@/lib/api/client";
import { getVerifiedUser, requireSession, requireAdmin, requireAuth } from "@/lib/auth/guard";

const userRole: SessionUser = {
  id: "u1",
  email: "user@example.com",
  name: "User One",
  role: "USER",
  status: "ACTIVE",
};

const adminRole: SessionUser = {
  id: "u2",
  email: "admin@example.com",
  name: "Admin One",
  role: "ADMIN",
  status: "ACTIVE",
};

const team: Team = {
  id: "t1",
  name: "Team One",
  slug: "team-one",
  createdAt: "2026-01-01T00:00:00.000Z",
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(redirect).mockImplementation((url: string) => {
    throw new RedirectError(url);
  });
});

describe("guard — requireSession", () => {
  it("redirects to /login when there is no session", async () => {
    (getSession as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    await expect(requireSession()).rejects.toThrow("NEXT_REDIRECT:/login");
    expect(redirect).toHaveBeenCalledWith("/login");
  });

  it("returns the session when present", async () => {
    const session = { token: "tok-1", user: userRole };
    (getSession as ReturnType<typeof vi.fn>).mockResolvedValue(session);

    await expect(requireSession()).resolves.toEqual(session);
    expect(redirect).not.toHaveBeenCalled();
  });
});

// The role comes from the backend (GET /auth/me), never from the readable
// telerithm_user cookie that getSession parses. Each case below pairs a cookie
// user with what the backend says.
describe("guard — requireAdmin", () => {
  const session = (cookieUser: SessionUser) =>
    (getSession as ReturnType<typeof vi.fn>).mockResolvedValue({ token: "tok-1", user: cookieUser });
  const backendSays = (user: SessionUser) =>
    (getCurrentUser as ReturnType<typeof vi.fn>).mockResolvedValue({ user });

  it("redirects to /login when there is no session, without asking the backend", async () => {
    (getSession as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    await expect(requireAdmin()).rejects.toThrow("NEXT_REDIRECT:/login");
    expect(getCurrentUser).not.toHaveBeenCalled();
  });

  it("redirects to / when the backend says USER and the cookie says USER", async () => {
    session(userRole);
    backendSays(userRole);

    await expect(requireAdmin()).rejects.toThrow("NEXT_REDIRECT:/");
    expect(redirect).toHaveBeenCalledWith("/");
  });

  it("redirects to / when the cookie is forged to ADMIN and the backend says USER", async () => {
    session({ ...userRole, role: "ADMIN" });
    backendSays(userRole);

    await expect(requireAdmin()).rejects.toThrow("NEXT_REDIRECT:/");
    expect(getCurrentUser).toHaveBeenCalledWith("tok-1");
  });

  it("lets a real admin in when the cookie says ADMIN too, and returns the backend's user", async () => {
    session(adminRole);
    backendSays(adminRole);

    await expect(requireAdmin()).resolves.toEqual({ token: "tok-1", user: adminRole });
    expect(redirect).not.toHaveBeenCalled();
  });

  it("lets a real admin in even when the cookie says USER: the backend wins", async () => {
    session(userRole);
    backendSays(adminRole);

    await expect(requireAdmin()).resolves.toEqual({ token: "tok-1", user: adminRole });
  });

  it("redirects to / when the backend cannot confirm a user (error), even for an ADMIN cookie", async () => {
    session(adminRole);
    (getCurrentUser as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("Unauthorized"));

    await expect(requireAdmin()).rejects.toThrow("NEXT_REDIRECT:/");
  });
});

describe("guard - getVerifiedUser", () => {
  it("returns the user the backend reports for the token", async () => {
    (getCurrentUser as ReturnType<typeof vi.fn>).mockResolvedValue({ user: adminRole });

    await expect(getVerifiedUser("tok-v1")).resolves.toEqual(adminRole);
    expect(getCurrentUser).toHaveBeenCalledWith("tok-v1");
  });

  it("returns null when the backend call fails", async () => {
    (getCurrentUser as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("API request failed: 500"));

    await expect(getVerifiedUser("tok-v2")).resolves.toBeNull();
  });
});

describe("guard — requireAuth", () => {
  it("throws when the user has no team", async () => {
    (getSession as ReturnType<typeof vi.fn>).mockResolvedValue({ token: "tok-1", user: userRole });
    (getTeams as ReturnType<typeof vi.fn>).mockResolvedValue({ teams: [] });

    await expect(requireAuth()).rejects.toThrow("No team found. Please create or join a team first.");
  });

  it("returns token, user and the first team when a team exists", async () => {
    (getSession as ReturnType<typeof vi.fn>).mockResolvedValue({ token: "tok-1", user: userRole });
    (getTeams as ReturnType<typeof vi.fn>).mockResolvedValue({ teams: [team] });

    await expect(requireAuth()).resolves.toEqual({ token: "tok-1", user: userRole, team });
    expect(getTeams).toHaveBeenCalledWith("tok-1");
  });
});
