import { afterEach, describe, expect, it, vi } from "vitest";

import { BROWSER_SESSION, deleteAlertRule, getTeams, serverApiBaseUrl } from "@/lib/api/client";
import { PROXY_HEADER } from "@/lib/api/proxy-constants";

function okFetch() {
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ teams: [] }) });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("authenticated calls: token versus proxy", () => {
  it("a client component's call goes to the same-origin proxy with the proxy header and no token", async () => {
    const fetchMock = okFetch();
    await getTeams(BROWSER_SESSION);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/bff/teams");
    const headers = init.headers as Record<string, string>;
    expect(headers[PROXY_HEADER]).toBe("1");
    expect(headers.Authorization).toBeUndefined();
  });

  it("a server call with the session token goes to the backend with the Authorization header", async () => {
    const fetchMock = okFetch();
    await getTeams("sess_server_side");

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/^https?:\/\/[^/]+\/api\/v1\/teams$/);
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer sess_server_side");
    expect(headers[PROXY_HEADER]).toBeUndefined();
  });

  it("keeps the method of a proxied call", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 204, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchMock);
    await deleteAlertRule("r 1", BROWSER_SESSION);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/bff/alerts/rules/r%201");
    expect(init.method).toBe("DELETE");
  });
});

// Precedence: INTERNAL_API_BASE_URL wins over NEXT_PUBLIC_API_BASE_URL, which
// wins over the local default. Each combination is its own case.
describe("serverApiBaseUrl precedence", () => {
  const INTERNAL = "http://backend:4000/api/v1";
  const PUBLIC = "https://api.example.test/api/v1";
  const DEFAULT = "http://localhost:4000/api/v1";

  it("uses the default when neither is set", () => {
    expect(serverApiBaseUrl({})).toBe(DEFAULT);
  });

  it("uses INTERNAL_API_BASE_URL when only it is set", () => {
    expect(serverApiBaseUrl({ INTERNAL_API_BASE_URL: INTERNAL })).toBe(INTERNAL);
  });

  it("uses NEXT_PUBLIC_API_BASE_URL when only it is set", () => {
    expect(serverApiBaseUrl({ NEXT_PUBLIC_API_BASE_URL: PUBLIC })).toBe(PUBLIC);
  });

  it("prefers INTERNAL_API_BASE_URL when both are set", () => {
    expect(serverApiBaseUrl({ INTERNAL_API_BASE_URL: INTERNAL, NEXT_PUBLIC_API_BASE_URL: PUBLIC })).toBe(INTERNAL);
  });

  it("keeps an empty INTERNAL_API_BASE_URL (set but empty is not absent)", () => {
    expect(serverApiBaseUrl({ INTERNAL_API_BASE_URL: "", NEXT_PUBLIC_API_BASE_URL: PUBLIC })).toBe("");
  });
});
