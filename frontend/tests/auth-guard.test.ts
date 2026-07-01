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
}));

import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { getTeams } from "@/lib/api/client";
import { requireSession, requireAdmin, requireAuth } from "@/lib/auth/guard";

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

describe("guard — requireAdmin", () => {
  it("redirects to / when the session user is not an ADMIN", async () => {
    (getSession as ReturnType<typeof vi.fn>).mockResolvedValue({ token: "tok-1", user: userRole });

    await expect(requireAdmin()).rejects.toThrow("NEXT_REDIRECT:/");
    expect(redirect).toHaveBeenCalledWith("/");
  });

  it("returns the session when the user is an ADMIN", async () => {
    const session = { token: "tok-2", user: adminRole };
    (getSession as ReturnType<typeof vi.fn>).mockResolvedValue(session);

    await expect(requireAdmin()).resolves.toEqual(session);
    expect(redirect).not.toHaveBeenCalled();
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
