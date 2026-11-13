import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// logoutAction with the real session module and a fake cookie store: the
// backend logout must be called from the token cookie alone.

const mockCookieStore = {
  get: vi.fn(),
  set: vi.fn(),
  delete: vi.fn(),
};

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => mockCookieStore),
}));

class RedirectError extends Error {}

vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new RedirectError(`NEXT_REDIRECT:${url}`);
  }),
}));

import { logoutAction } from "@/lib/auth/actions";

describe("logoutAction cookie handling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 204 } as Response));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("calls the backend logout when only the token cookie is present (user cookie absent)", async () => {
    mockCookieStore.get.mockImplementation((name: string) =>
      name === "telerithm_token" ? { value: "tok-123" } : undefined,
    );

    await expect(logoutAction()).rejects.toThrow("NEXT_REDIRECT:/login");

    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(String(url)).toMatch(/\/auth\/logout$/);
    expect(init.headers).toEqual({ Authorization: "Bearer tok-123" });
    expect(mockCookieStore.delete).toHaveBeenCalledWith("telerithm_token");
    expect(mockCookieStore.delete).toHaveBeenCalledWith("telerithm_user");
  });

  it("does not call the backend when there is no token cookie, and still clears both cookies", async () => {
    mockCookieStore.get.mockReturnValue(undefined);

    await expect(logoutAction()).rejects.toThrow("NEXT_REDIRECT:/login");

    expect(fetch).not.toHaveBeenCalled();
    expect(mockCookieStore.delete).toHaveBeenCalledWith("telerithm_token");
    expect(mockCookieStore.delete).toHaveBeenCalledWith("telerithm_user");
  });

  it("passes an abort signal so a hanging backend cannot block logout", async () => {
    mockCookieStore.get.mockImplementation((name: string) =>
      name === "telerithm_token" ? { value: "tok-123" } : undefined,
    );

    await expect(logoutAction()).rejects.toThrow("NEXT_REDIRECT:/login");

    const init = (fetch as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });
});
