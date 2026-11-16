// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getSessionToken: vi.fn() }));

vi.mock("@/lib/auth/session", () => ({ getSessionToken: mocks.getSessionToken }));

import { DELETE, GET } from "@/app/api/proxy/[...path]/route";
import { PROXY_HEADER } from "@/lib/api/proxy-constants";
import type { NextRequest } from "next/server";

function call(handler: typeof GET, method: string, path: string[]) {
  const request = new Request(`http://frontend.test/api/proxy/${path.join("/")}?teamId=t1`, {
    method,
    headers: { [PROXY_HEADER]: "1" },
  }) as unknown as NextRequest;
  return handler(request, { params: Promise.resolve({ path }) });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("proxy route handler", () => {
  it("reads the session token from the cookie and calls the configured backend with it", async () => {
    vi.stubEnv("INTERNAL_API_BASE_URL", "http://backend.internal:4000/api/v1");
    mocks.getSessionToken.mockResolvedValue("sess_from_cookie");
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await call(GET, "GET", ["sources"]);

    expect(response.status).toBe(200);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [URL, RequestInit];
    expect(String(url)).toBe("http://backend.internal:4000/api/v1/sources?teamId=t1");
    expect(new Headers(init.headers).get("authorization")).toBe("Bearer sess_from_cookie");
  });

  it("answers 401 without a backend call when the cookie is missing", async () => {
    mocks.getSessionToken.mockResolvedValue(null);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await call(DELETE, "DELETE", ["sources", "s1"]);

    expect(response.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
