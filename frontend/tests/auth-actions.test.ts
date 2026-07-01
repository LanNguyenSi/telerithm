import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionUser } from "@/types";

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
  setSession: vi.fn(),
  clearSession: vi.fn(),
}));

import { redirect } from "next/navigation";
import { setSession, clearSession } from "@/lib/auth/session";
import { loginAction, registerAction, logoutAction } from "@/lib/auth/actions";

const user: SessionUser = {
  id: "u1",
  email: "user@example.com",
  name: "User One",
  role: "USER",
  status: "ACTIVE",
};

function formData(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    fd.set(key, value);
  }
  return fd;
}

function jsonResponse(body: unknown, ok: boolean): Response {
  return {
    ok,
    json: async () => body,
  } as Response;
}

describe("actions — loginAction", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(redirect).mockImplementation((url: string) => {
      throw new RedirectError(url);
    });
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("returns an error and does not call fetch when email or password is missing", async () => {
    const result = await loginAction(undefined, formData({ email: "" , password: "" }));

    expect(result).toEqual({ error: "Email and password are required" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("returns the server error message when the response is not ok", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse({ error: "Invalid credentials" }, false),
    );

    const result = await loginAction(undefined, formData({ email: "a@b.com", password: "pw" }));

    expect(result).toEqual({ error: "Invalid credentials" });
  });

  it("falls back to a default error message when the error body cannot be parsed", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      json: async () => {
        throw new Error("bad json");
      },
    } as unknown as Response);

    const result = await loginAction(undefined, formData({ email: "a@b.com", password: "pw" }));

    expect(result).toEqual({ error: "Login failed" });
  });

  it("sets the session and redirects to / on success", async () => {
    vi.stubEnv("INTERNAL_API_BASE_URL", "http://internal-api/api/v1");
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse({ token: "tok-123", user }, true),
    );

    await expect(
      loginAction(undefined, formData({ email: "a@b.com", password: "pw" })),
    ).rejects.toThrow("NEXT_REDIRECT:/");

    expect(fetch).toHaveBeenCalledWith(
      "http://internal-api/api/v1/auth/login",
      expect.objectContaining({ method: "POST" }),
    );
    expect(setSession).toHaveBeenCalledWith("tok-123", user);
    expect(redirect).toHaveBeenCalledWith("/");
  });
});

describe("actions — registerAction", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(redirect).mockImplementation((url: string) => {
      throw new RedirectError(url);
    });
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("returns an error and does not call fetch when a required field is missing", async () => {
    const result = await registerAction(
      undefined,
      formData({ email: "a@b.com", password: "", name: "A" }),
    );

    expect(result).toEqual({ error: "All fields are required" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("returns the server error message when the response is not ok", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse({ error: "Email already taken" }, false),
    );

    const result = await registerAction(
      undefined,
      formData({ email: "a@b.com", password: "pw", name: "A" }),
    );

    expect(result).toEqual({ error: "Email already taken" });
  });

  it("falls back to a default error message when not ok and body has no error field", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({}, false));

    const result = await registerAction(
      undefined,
      formData({ email: "a@b.com", password: "pw", name: "A" }),
    );

    expect(result).toEqual({ error: "Registration failed" });
  });

  it("falls back to a default error message when the error body cannot be parsed", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      json: async () => {
        throw new Error("bad json");
      },
    } as unknown as Response);

    const result = await registerAction(
      undefined,
      formData({ email: "a@b.com", password: "pw", name: "A" }),
    );

    expect(result).toEqual({ error: "Registration failed" });
  });

  it("returns a pendingApproval result without setting a session when the account needs approval", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse({ status: "pending_approval", message: "Awaiting admin approval" }, true),
    );

    const result = await registerAction(
      undefined,
      formData({ email: "a@b.com", password: "pw", name: "A" }),
    );

    expect(result).toEqual({ success: "Awaiting admin approval", pendingApproval: true });
    expect(setSession).not.toHaveBeenCalled();
    expect(redirect).not.toHaveBeenCalled();
  });

  it("sets the session and redirects to / when a token is returned", async () => {
    vi.stubEnv("INTERNAL_API_BASE_URL", "http://internal-api/api/v1");
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse({ token: "tok-456", user }, true),
    );

    await expect(
      registerAction(undefined, formData({ email: "a@b.com", password: "pw", name: "A" })),
    ).rejects.toThrow("NEXT_REDIRECT:/");

    expect(fetch).toHaveBeenCalledWith(
      "http://internal-api/api/v1/auth/register",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ email: "a@b.com", password: "pw", name: "A" }),
      }),
    );
    expect(setSession).toHaveBeenCalledWith("tok-456", user);
    expect(redirect).toHaveBeenCalledWith("/");
  });
});

describe("actions — logoutAction", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(redirect).mockImplementation((url: string) => {
      throw new RedirectError(url);
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("clears the session and redirects to /login", async () => {
    await expect(logoutAction()).rejects.toThrow("NEXT_REDIRECT:/login");

    expect(clearSession).toHaveBeenCalled();
    expect(redirect).toHaveBeenCalledWith("/login");
  });
});
