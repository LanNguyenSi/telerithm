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

describe("middleware - authenticated requests", () => {
  const AUTH_COOKIES = { telerithm_token: "valid-session-token" };

  it("passes through a normal authenticated request", () => {
    const res = middleware(makeRequest("/dashboard", AUTH_COOKIES));
    expect(isPassThrough(res)).toBe(true);
  });

  it("passes through the root path when authenticated", () => {
    const res = middleware(makeRequest("/", AUTH_COOKIES));
    expect(isPassThrough(res)).toBe(true);
  });
});

// The middleware checks that a session cookie exists and nothing else. Which
// role the session has is decided on the server by requireAdmin (see
// auth-guard.test.ts and admin-gate.test.tsx), because telerithm_user is
// readable and writable by the browser: whatever it holds must not change the
// middleware's answer, in either direction.
describe("middleware - /admin does not trust the telerithm_user cookie", () => {
  const TOKEN = { telerithm_token: "valid-session-token" };
  const userCookies: Array<[string, Record<string, string>]> = [
    ["no user cookie", {}],
    ["role USER", { telerithm_user: JSON.stringify({ role: "USER" }) }],
    ["role ADMIN (possibly forged)", { telerithm_user: JSON.stringify({ role: "ADMIN" }) }],
    ["no role field", { telerithm_user: JSON.stringify({ userId: "u1" }) }],
    ["invalid JSON", { telerithm_user: "not-valid-json{{{" }],
  ];

  it.each(userCookies)("passes /admin through with a token and %s", (_name, cookies) => {
    const res = middleware(makeRequest("/admin", { ...TOKEN, ...cookies }));
    expect(isPassThrough(res)).toBe(true);
  });

  it.each(userCookies)("passes /admin/users through with a token and %s", (_name, cookies) => {
    const res = middleware(makeRequest("/admin/users", { ...TOKEN, ...cookies }));
    expect(isPassThrough(res)).toBe(true);
  });

  it("still sends /admin to /login without a token, whatever the user cookie says", () => {
    const res = middleware(makeRequest("/admin", { telerithm_user: JSON.stringify({ role: "ADMIN" }) }));
    expect(res.status).toBe(307);
    expect(redirectTarget(res)).toBe("/login");
  });
});
