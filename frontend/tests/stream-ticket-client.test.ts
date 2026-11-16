import { afterEach, describe, expect, it, vi } from "vitest";
import { BROWSER_SESSION, createStreamTicket, getCurrentUser, streamLogs } from "@/lib/api/client";
import { PROXY_HEADER } from "@/lib/api/proxy-constants";

afterEach(() => {
  vi.unstubAllGlobals();
});

function okFetch(body: unknown, status = 200) {
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, status, json: async () => body });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("createStreamTicket", () => {
  it("posts the team to the same-origin proxy with the proxy header and no token", async () => {
    const fetchMock = okFetch({ ticket: "tk", expiresInSeconds: 60 }, 201);

    await expect(createStreamTicket("team-1", BROWSER_SESSION)).resolves.toEqual({ ticket: "tk", expiresInSeconds: 60 });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/bff/stream/ticket");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ teamId: "team-1" });
    const headers = init.headers as Record<string, string>;
    expect(headers[PROXY_HEADER]).toBe("1");
    expect(headers.Authorization).toBeUndefined();
  });

  it("surfaces the API's error message", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 403, json: async () => ({ error: "Forbidden" }) }),
    );

    await expect(createStreamTicket("team-1", BROWSER_SESSION)).rejects.toThrow("Forbidden");
  });
});

describe("streamLogs", () => {
  class FakeEventSource {
    static urls: string[] = [];
    constructor(url: string) {
      FakeEventSource.urls.push(url);
    }
  }

  function streamUrl(...args: Parameters<typeof streamLogs>) {
    FakeEventSource.urls = [];
    vi.stubGlobal("EventSource", FakeEventSource);
    streamLogs(...args);
    return new URL(FakeEventSource.urls[0], "http://localhost");
  }

  it("opens the backend stream with the team and the ticket, and no token", () => {
    const url = streamUrl("team-1", "tk-1");

    expect(url.pathname).toMatch(/\/stream\/logs$/);
    expect(url.searchParams.get("teamId")).toBe("team-1");
    expect(url.searchParams.get("ticket")).toBe("tk-1");
    expect(url.searchParams.has("token")).toBe(false);
    expect(url.search).not.toMatch(/token=/);
  });

  it("adds only the filters that are set", () => {
    const url = streamUrl("team-1", "tk-1", { level: "error", service: "", query: "boom" });

    expect(url.searchParams.get("level")).toBe("error");
    expect(url.searchParams.get("query")).toBe("boom");
    expect(url.searchParams.has("service")).toBe(false);
    expect(url.searchParams.has("host")).toBe(false);
  });
});

describe("getCurrentUser", () => {
  it("asks the backend with the session token as the Authorization header", async () => {
    const user = { id: "u1", email: "a@example.test", name: "A", role: "ADMIN", status: "ACTIVE" };
    const fetchMock = okFetch({ user });

    await expect(getCurrentUser("sess_server_side")).resolves.toEqual({ user });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/^https?:\/\/[^/]+\/api\/v1\/auth\/me$/);
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer sess_server_side");
  });
});
