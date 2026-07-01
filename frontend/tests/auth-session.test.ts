import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionUser } from "@/types";

const mockCookieStore = {
  get: vi.fn(),
  set: vi.fn(),
  delete: vi.fn(),
};

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => mockCookieStore),
}));

import { getSession, setSession, clearSession } from "@/lib/auth/session";

const user: SessionUser = {
  id: "u1",
  email: "user@example.com",
  name: "User One",
  role: "USER",
  status: "ACTIVE",
};

describe("session — getSession", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns null when the token cookie is missing", async () => {
    mockCookieStore.get.mockImplementation((name: string) => {
      if (name === "telerithm_token") return undefined;
      if (name === "telerithm_user") return { value: JSON.stringify(user) };
      return undefined;
    });

    await expect(getSession()).resolves.toBeNull();
  });

  it("returns null when the user cookie contains invalid JSON", async () => {
    mockCookieStore.get.mockImplementation((name: string) => {
      if (name === "telerithm_token") return { value: "tok-123" };
      if (name === "telerithm_user") return { value: "not-valid-json{{{" };
      return undefined;
    });

    await expect(getSession()).resolves.toBeNull();
  });

  it("returns the token and parsed user on the happy path", async () => {
    mockCookieStore.get.mockImplementation((name: string) => {
      if (name === "telerithm_token") return { value: "tok-123" };
      if (name === "telerithm_user") return { value: JSON.stringify(user) };
      return undefined;
    });

    await expect(getSession()).resolves.toEqual({ token: "tok-123", user });
  });
});

describe("session — setSession", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("sets the token cookie httpOnly and the user cookie non-httpOnly, secure in production", async () => {
    vi.stubEnv("NODE_ENV", "production");

    await setSession("tok-abc", user);

    expect(mockCookieStore.set).toHaveBeenCalledWith(
      "telerithm_token",
      "tok-abc",
      expect.objectContaining({
        httpOnly: true,
        secure: true,
        sameSite: "lax",
        path: "/",
        maxAge: 604800,
      }),
    );
    expect(mockCookieStore.set).toHaveBeenCalledWith(
      "telerithm_user",
      JSON.stringify(user),
      expect.objectContaining({
        httpOnly: false,
        secure: true,
        sameSite: "lax",
        path: "/",
        maxAge: 604800,
      }),
    );
  });

  it("sets secure:false outside production", async () => {
    vi.stubEnv("NODE_ENV", "test");

    await setSession("tok-abc", user);

    expect(mockCookieStore.set).toHaveBeenCalledWith(
      "telerithm_token",
      "tok-abc",
      expect.objectContaining({ secure: false }),
    );
    expect(mockCookieStore.set).toHaveBeenCalledWith(
      "telerithm_user",
      JSON.stringify(user),
      expect.objectContaining({ secure: false }),
    );
  });
});

describe("session — clearSession", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("deletes both the token and user cookies", async () => {
    await clearSession();

    expect(mockCookieStore.delete).toHaveBeenCalledWith("telerithm_token");
    expect(mockCookieStore.delete).toHaveBeenCalledWith("telerithm_user");
  });
});
