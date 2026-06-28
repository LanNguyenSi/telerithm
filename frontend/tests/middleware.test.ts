import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { middleware } from "../src/middleware";

/**
 * Build a NextRequest for the given path with optional cookies.
 * Cookies are passed as a map of name -> raw value (no encoding).
 */
function makeRequest(path: string, cookies: Record<string, string> = {}): NextRequest {
  const url = `http://localhost${path}`;
  const cookieHeader = Object.entries(cookies)
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
  const headers: HeadersInit = cookieHeader ? { Cookie: cookieHeader } : {};
  return new NextRequest(url, { headers });
}

/** Extract the redirect location from a response, or null if not a redirect. */
function redirectTarget(res: Response): string | null {
  if (res.status !== 307 && res.status !== 302) return null;
  const loc = res.headers.get("location");
  if (!loc) return null;
  // Strip the origin so we get only the path
  return new URL(loc).pathname;
}

/** True when the middleware passes the request through (NextResponse.next()). */
function isPassThrough(res: Response): boolean {
  return res.headers.get("x-middleware-next") === "1";
}

describe("middleware — public paths (no auth check)", () => {
  it("passes through /login without requiring a token", () => {
    const res = middleware(makeRequest("/login"));
    expect(isPassThrough(res)).toBe(true);
  });

  it("passes through /login/reset (sub-path of /login)", () => {
    const res = middleware(makeRequest("/login/reset"));
    expect(isPassThrough(res)).toBe(true);
  });

  it("passes through /register without a token", () => {
    const res = middleware(makeRequest("/register"));
    expect(isPassThrough(res)).toBe(true);
  });
});

describe("middleware — unauthenticated users (no token)", () => {
  it("redirects to /login when no telerithm_token cookie is present", () => {
    const res = middleware(makeRequest("/dashboard"));
    expect(res.status).toBe(307);
    expect(redirectTarget(res)).toBe("/login");
  });

  it("redirects to /login for the root path without a token", () => {
    const res = middleware(makeRequest("/"));
    expect(res.status).toBe(307);
    expect(redirectTarget(res)).toBe("/login");
  });

  it("redirects to /login for an /admin path without a token", () => {
    const res = middleware(makeRequest("/admin/users"));
    expect(res.status).toBe(307);
    expect(redirectTarget(res)).toBe("/login");
  });
});

describe("middleware — authenticated non-admin users", () => {
  const AUTH_COOKIES = { telerithm_token: "valid-session-token" };

  it("passes through a normal authenticated request", () => {
    const res = middleware(makeRequest("/dashboard", AUTH_COOKIES));
    expect(isPassThrough(res)).toBe(true);
  });

  it("passes through the root path when authenticated", () => {
    const res = middleware(makeRequest("/", AUTH_COOKIES));
    expect(isPassThrough(res)).toBe(true);
  });

  it("redirects non-admin user away from /admin to /", () => {
    const res = middleware(
      makeRequest("/admin", {
        ...AUTH_COOKIES,
        telerithm_user: JSON.stringify({ role: "USER" }),
      }),
    );
    expect(res.status).toBe(307);
    expect(redirectTarget(res)).toBe("/");
  });

  it("redirects authenticated user with no telerithm_user cookie away from /admin to /", () => {
    // Token present, but no user-info cookie — role defaults to null -> not ADMIN
    const res = middleware(makeRequest("/admin/settings", AUTH_COOKIES));
    expect(res.status).toBe(307);
    expect(redirectTarget(res)).toBe("/");
  });

  it("redirects authenticated user on /admin sub-path to / when role is USER", () => {
    const res = middleware(
      makeRequest("/admin/teams", {
        ...AUTH_COOKIES,
        telerithm_user: JSON.stringify({ role: "USER" }),
      }),
    );
    expect(res.status).toBe(307);
    expect(redirectTarget(res)).toBe("/");
  });
});

describe("middleware — admin users", () => {
  const ADMIN_COOKIES = {
    telerithm_token: "valid-session-token",
    telerithm_user: JSON.stringify({ role: "ADMIN" }),
  };

  it("passes through /admin for an ADMIN-role user", () => {
    const res = middleware(makeRequest("/admin", ADMIN_COOKIES));
    expect(isPassThrough(res)).toBe(true);
  });

  it("passes through /admin/users for an ADMIN-role user", () => {
    const res = middleware(makeRequest("/admin/users", ADMIN_COOKIES));
    expect(isPassThrough(res)).toBe(true);
  });

  it("passes through /dashboard for an ADMIN-role user (admin check only on /admin paths)", () => {
    const res = middleware(makeRequest("/dashboard", ADMIN_COOKIES));
    expect(isPassThrough(res)).toBe(true);
  });
});

describe("middleware — malformed telerithm_user cookie", () => {
  const TOKEN_COOKIES = { telerithm_token: "valid-session-token" };

  it("redirects to /login when telerithm_user contains invalid JSON on an /admin path", () => {
    const res = middleware(
      makeRequest("/admin/dashboard", {
        ...TOKEN_COOKIES,
        telerithm_user: "not-valid-json{{{",
      }),
    );
    expect(res.status).toBe(307);
    expect(redirectTarget(res)).toBe("/login");
  });

  it("redirects to /login when telerithm_user is a bare string (not an object)", () => {
    const res = middleware(
      makeRequest("/admin", {
        ...TOKEN_COOKIES,
        telerithm_user: "just-a-string",
      }),
    );
    // "just-a-string" is valid JSON (a string literal), role is undefined -> redirects to /
    // Hmm, actually JSON.parse("just-a-string") throws because it's not valid JSON
    expect(res.status).toBe(307);
    // Could be /login (parse error) or / (valid JSON with no role)
    // "just-a-string" without surrounding quotes is NOT valid JSON, so it throws -> /login
    expect(redirectTarget(res)).toBe("/login");
  });

  it("redirects to / when telerithm_user is valid JSON without a role field", () => {
    // Valid JSON, but no role key -> role is undefined -> not ADMIN -> redirect to /
    const res = middleware(
      makeRequest("/admin", {
        ...TOKEN_COOKIES,
        telerithm_user: JSON.stringify({ userId: "u1" }),
      }),
    );
    expect(res.status).toBe(307);
    expect(redirectTarget(res)).toBe("/");
  });
});
