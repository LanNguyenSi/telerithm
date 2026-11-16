// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";

import { buildBackendUrl, clientAddressFrom, MAX_PROXY_BODY_BYTES, proxyRequest } from "@/lib/api/proxy";
import { PROXY_HEADER } from "@/lib/api/proxy-constants";

const BACKEND = "http://backend.internal:4000/api/v1";
const TOKEN = "sess_proxy_test_token";

function upstream(body: BodyInit | null, init?: ResponseInit) {
  return vi.fn(async (_url: URL | RequestInfo, _init?: RequestInit) => new Response(body, init));
}

function proxied(path: string, init: RequestInit & { noHeader?: boolean } = {}) {
  const headers = new Headers(init.headers);
  if (!init.noHeader) headers.set(PROXY_HEADER, "1");
  return new Request(`http://frontend.test/bff/${path}`, { ...init, headers });
}

function calledUrl(fetchImpl: ReturnType<typeof upstream>): URL {
  return new URL(String(fetchImpl.mock.calls[0][0]));
}

function calledInit(fetchImpl: ReturnType<typeof upstream>): RequestInit {
  return fetchImpl.mock.calls[0][1] as RequestInit;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("proxyRequest: authentication", () => {
  it("forwards the cookie token as the Authorization header, with method, path and query", async () => {
    const fetchImpl = upstream(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } });
    const response = await proxyRequest(proxied("logs/views?teamId=t1&x=a%20b"), ["logs", "views"], {
      token: TOKEN,
      backendBaseUrl: BACKEND,
      fetchImpl,
    });

    expect(response.status).toBe(200);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(calledUrl(fetchImpl).toString()).toBe(`${BACKEND}/logs/views?teamId=t1&x=a%20b`);
    const init = calledInit(fetchImpl);
    expect(init.method).toBe("GET");
    expect(new Headers(init.headers).get("authorization")).toBe(`Bearer ${TOKEN}`);
    expect(init.redirect).toBe("manual");
  });

  it("answers 401 without calling the backend when there is no session cookie", async () => {
    const fetchImpl = upstream("{}");
    const response = await proxyRequest(proxied("teams"), ["teams"], { token: null, backendBaseUrl: BACKEND, fetchImpl });

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Not authenticated" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("treats an empty cookie value as no session", async () => {
    const fetchImpl = upstream("{}");
    const response = await proxyRequest(proxied("teams"), ["teams"], { token: "", backendBaseUrl: BACKEND, fetchImpl });

    expect(response.status).toBe(401);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("refuses a request without the proxy header (a cross-site form or image cannot set it)", async () => {
    const fetchImpl = upstream("{}");
    const response = await proxyRequest(proxied("sources/s1", { method: "DELETE", noHeader: true }), ["sources", "s1"], {
      token: TOKEN,
      backendBaseUrl: BACKEND,
      fetchImpl,
    });

    expect(response.status).toBe(403);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("refuses a proxy header with another value", async () => {
    const fetchImpl = upstream("{}");
    const response = await proxyRequest(
      proxied("teams", { noHeader: true, headers: { [PROXY_HEADER]: "yes" } }),
      ["teams"],
      { token: TOKEN, backendBaseUrl: BACKEND, fetchImpl },
    );

    expect(response.status).toBe(403);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("never forwards the browser's own Authorization, Cookie or forwarding headers", async () => {
    const fetchImpl = upstream("{}", { status: 200 });
    await proxyRequest(
      proxied("teams", {
        headers: {
          authorization: "Bearer someone-else",
          cookie: "telerithm_token=abc",
          host: "evil.example",
          "x-forwarded-host": "evil.example",
          accept: "application/json",
        },
      }),
      ["teams"],
      { token: TOKEN, backendBaseUrl: BACKEND, fetchImpl },
    );

    const headers = new Headers(calledInit(fetchImpl).headers);
    expect(headers.get("authorization")).toBe(`Bearer ${TOKEN}`);
    expect(headers.get("cookie")).toBeNull();
    expect(headers.get("host")).toBeNull();
    expect(headers.get("x-forwarded-host")).toBeNull();
    expect(headers.get("accept")).toBe("application/json");
  });

  it("refuses a method outside the API's set", async () => {
    const fetchImpl = upstream("{}");
    const response = await proxyRequest(proxied("teams", { method: "OPTIONS" }), ["teams"], {
      token: TOKEN,
      backendBaseUrl: BACKEND,
      fetchImpl,
    });

    expect(response.status).toBe(405);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("proxyRequest: path", () => {
  it.each([
    ["a parent segment", ["..", "admin", "users"]],
    ["a parent segment in the middle", ["logs", "..", "..", "x"]],
    ["a parent segment that would still resolve inside the API path", ["logs", "..", "teams"]],
    ["a current-directory segment", ["logs", ".", "views"]],
    ["an empty segment", ["logs", "", "views"]],
    ["a decoded slash inside a segment", ["logs%2F..", "a/b"]],
    ["a backslash", ["logs\\..\\admin"]],
    ["a control character", ["logs\nx"]],
    ["no segment at all", []],
  ])("refuses %s without calling the backend", async (_name, segments) => {
    const fetchImpl = upstream("{}");
    const response = await proxyRequest(proxied("x"), segments, { token: TOKEN, backendBaseUrl: BACKEND, fetchImpl });

    expect(response.status).toBe(400);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("keeps an absolute URL in the path on the configured backend host", async () => {
    const fetchImpl = upstream("{}", { status: 404 });
    await proxyRequest(proxied("x"), ["https:", "evil.example", "steal"], {
      token: TOKEN,
      backendBaseUrl: BACKEND,
      fetchImpl,
    });

    const url = calledUrl(fetchImpl);
    expect(url.origin).toBe("http://backend.internal:4000");
    expect(url.pathname).toBe("/api/v1/https%3A/evil.example/steal");
  });

  it("encodes a percent-encoded dot segment instead of letting the URL parser resolve it", () => {
    const url = buildBackendUrl(BACKEND, ["%2e%2e", "admin"], "");
    expect(url?.pathname).toBe("/api/v1/%252e%252e/admin");
  });

  it("encodes characters that would start a query or fragment", () => {
    const url = buildBackendUrl(BACKEND, ["logs", "a?b#c"], "?teamId=t1");
    expect(url?.pathname).toBe("/api/v1/logs/a%3Fb%23c");
    expect(url?.search).toBe("?teamId=t1");
  });

  it("works with a backend base URL that has a trailing slash or no path", () => {
    expect(buildBackendUrl("http://b:4000/api/v1/", ["teams"], "")?.toString()).toBe("http://b:4000/api/v1/teams");
    expect(buildBackendUrl("http://b:4000", ["teams"], "")?.toString()).toBe("http://b:4000/teams");
  });
});

describe("proxyRequest: body", () => {
  it("forwards a JSON body with its content type", async () => {
    const fetchImpl = upstream("{}", { status: 201 });
    const payload = JSON.stringify({ teamId: "t1", name: "web" });
    await proxyRequest(
      proxied("sources", { method: "POST", body: payload, headers: { "content-type": "application/json" } }),
      ["sources"],
      { token: TOKEN, backendBaseUrl: BACKEND, fetchImpl },
    );

    const init = calledInit(fetchImpl);
    expect(init.method).toBe("POST");
    expect(new TextDecoder().decode(init.body as Uint8Array)).toBe(payload);
    expect(new Headers(init.headers).get("content-type")).toBe("application/json");
  });

  it("forwards a body of exactly the limit", async () => {
    const fetchImpl = upstream("{}", { status: 200 });
    const response = await proxyRequest(proxied("sources", { method: "PUT", body: "x".repeat(16) }), ["sources"], {
      token: TOKEN,
      backendBaseUrl: BACKEND,
      fetchImpl,
      maxBodyBytes: 16,
    });

    expect(response.status).toBe(200);
    expect((calledInit(fetchImpl).body as Uint8Array).byteLength).toBe(16);
  });

  it("answers 413 for a body one byte over the limit, without calling the backend", async () => {
    const fetchImpl = upstream("{}");
    const response = await proxyRequest(proxied("sources", { method: "POST", body: "x".repeat(17) }), ["sources"], {
      token: TOKEN,
      backendBaseUrl: BACKEND,
      fetchImpl,
      maxBodyBytes: 16,
    });

    expect(response.status).toBe(413);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("answers 413 for a streamed body without Content-Length that grows past the limit", async () => {
    const fetchImpl = upstream("{}");
    const chunk = new Uint8Array(10);
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(chunk);
        controller.enqueue(chunk);
        controller.close();
      },
    });
    const request = proxied("sources", { method: "POST", body: stream, duplex: "half" } as RequestInit);
    expect(request.headers.get("content-length")).toBeNull();

    const response = await proxyRequest(request, ["sources"], {
      token: TOKEN,
      backendBaseUrl: BACKEND,
      fetchImpl,
      maxBodyBytes: 15,
    });

    expect(response.status).toBe(413);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("answers 413 from a declared Content-Length over the limit before reading the body", async () => {
    const fetchImpl = upstream("{}");
    const request = proxied("sources", { method: "POST", body: "small" });
    const headers = new Headers(request.headers);
    headers.set("content-length", String(MAX_PROXY_BODY_BYTES + 1));
    const response = await proxyRequest(new Request(request, { headers }), ["sources"], {
      token: TOKEN,
      backendBaseUrl: BACKEND,
      fetchImpl,
    });

    expect(response.status).toBe(413);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("sends no body for an empty POST body", async () => {
    const fetchImpl = upstream("{}", { status: 200 });
    await proxyRequest(proxied("sources/s1/rotate-key", { method: "POST", body: "" }), ["sources", "s1", "rotate-key"], {
      token: TOKEN,
      backendBaseUrl: BACKEND,
      fetchImpl,
    });
    expect(calledInit(fetchImpl).body).toBeUndefined();
  });

  it("sends no body for GET", async () => {
    const fetchImpl = upstream("{}", { status: 200 });
    await proxyRequest(proxied("teams"), ["teams"], { token: TOKEN, backendBaseUrl: BACKEND, fetchImpl });
    expect(calledInit(fetchImpl).body).toBeUndefined();
  });
});

describe("proxyRequest: response", () => {
  it("passes the backend's error status and body through", async () => {
    const fetchImpl = upstream(JSON.stringify({ error: "Alert rule not found" }), {
      status: 404,
      headers: { "content-type": "application/json" },
    });
    const response = await proxyRequest(proxied("alerts/rules/r1", { method: "DELETE" }), ["alerts", "rules", "r1"], {
      token: TOKEN,
      backendBaseUrl: BACKEND,
      fetchImpl,
    });

    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toBe("application/json");
    expect(await response.json()).toEqual({ error: "Alert rule not found" });
  });

  it("passes a 204 through with no body", async () => {
    const fetchImpl = upstream(null, { status: 204 });
    const response = await proxyRequest(proxied("sources/s1", { method: "DELETE" }), ["sources", "s1"], {
      token: TOKEN,
      backendBaseUrl: BACKEND,
      fetchImpl,
    });

    expect(response.status).toBe(204);
    expect(response.body).toBeNull();
  });

  it("drops a body the backend sent with a 204 instead of failing on it", async () => {
    const stray = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("stray"));
        controller.close();
      },
    });
    const fetchImpl = vi.fn(async () => ({ status: 204, statusText: "No Content", headers: new Headers(), body: stray }) as unknown as Response);
    const response = await proxyRequest(proxied("sources/s1", { method: "DELETE" }), ["sources", "s1"], {
      token: TOKEN,
      backendBaseUrl: BACKEND,
      fetchImpl,
    });

    expect(response.status).toBe(204);
    expect(response.body).toBeNull();
  });

  it("forwards only the allowlisted response headers and marks the answer no-store", async () => {
    const fetchImpl = upstream("{}", {
      status: 200,
      headers: {
        "content-type": "application/json",
        "retry-after": "30",
        "content-encoding": "gzip",
        "set-cookie": "backend=1",
        location: "http://evil.example/",
      },
    });
    const response = await proxyRequest(proxied("teams"), ["teams"], { token: TOKEN, backendBaseUrl: BACKEND, fetchImpl });

    expect(response.headers.get("retry-after")).toBe("30");
    expect(response.headers.get("content-encoding")).toBeNull();
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("streams the backend body through as it arrives", async () => {
    const encoder = new TextEncoder();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        controller.enqueue(encoder.encode("first\n"));
        await gate;
        controller.enqueue(encoder.encode("second\n"));
        controller.close();
      },
    });
    const fetchImpl = upstream(stream, { status: 200, headers: { "content-type": "text/plain" } });
    const response = await proxyRequest(proxied("export"), ["export"], { token: TOKEN, backendBaseUrl: BACKEND, fetchImpl });

    const reader = response.body!.getReader();
    const first = await reader.read();
    expect(new TextDecoder().decode(first.value)).toBe("first\n");
    release();
    const second = await reader.read();
    expect(new TextDecoder().decode(second.value)).toBe("second\n");
  });

  it("answers 502 for a response outside the HTTP status range (an opaque redirect has status 0)", async () => {
    const fetchImpl = vi.fn(async () => ({ status: 0, statusText: "", headers: new Headers(), body: null }) as unknown as Response);
    const response = await proxyRequest(proxied("teams"), ["teams"], { token: TOKEN, backendBaseUrl: BACKEND, fetchImpl });

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: "Unexpected backend response" });
  });

  it("answers 502 when the backend cannot be reached", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    const response = await proxyRequest(proxied("teams"), ["teams"], { token: TOKEN, backendBaseUrl: BACKEND, fetchImpl });

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: "Backend unreachable" });
  });
});

describe("proxyRequest: client address for the backend's rate limits", () => {
  // The rightmost X-Forwarded-For entry wins (the edge proxy appended it); every
  // entry to its left is the caller's and is dropped. Nothing is sent when the
  // header is absent or the rightmost entry is not an IP address.
  async function forwardedFor(xff: string[] | null): Promise<string | null> {
    const fetchImpl = upstream("{}", { status: 200 });
    const headers = new Headers({ [PROXY_HEADER]: "1" });
    for (const value of xff ?? []) headers.append("x-forwarded-for", value);
    await proxyRequest(new Request("http://frontend.test/bff/teams", { headers }), ["teams"], {
      token: TOKEN,
      backendBaseUrl: BACKEND,
      fetchImpl,
    });
    return new Headers(calledInit(fetchImpl).headers).get("x-forwarded-for");
  }

  it("forwards nothing when the header is absent", async () => {
    expect(await forwardedFor(null)).toBeNull();
  });

  it("forwards a single value", async () => {
    expect(await forwardedFor(["203.0.113.7"])).toBe("203.0.113.7");
  });

  it("forwards only the rightmost of several values", async () => {
    expect(await forwardedFor(["198.51.100.1, 10.0.0.2, 203.0.113.7"])).toBe("203.0.113.7");
  });

  it("trims whitespace around the rightmost entry", async () => {
    expect(await forwardedFor(["198.51.100.1 ,   203.0.113.7  "])).toBe("203.0.113.7");
  });

  it("forwards nothing when the rightmost entry is empty, instead of falling back to a caller-chosen one", async () => {
    expect(await forwardedFor(["198.51.100.1, "])).toBeNull();
  });

  it("forwards nothing for an empty header", async () => {
    expect(await forwardedFor([""])).toBeNull();
  });

  it("forwards nothing when the rightmost entry is not an IP address", async () => {
    expect(await forwardedFor(["203.0.113.7, not-an-ip"])).toBeNull();
  });

  it("keeps the edge proxy's entry when the browser sent its own X-Forwarded-For line first", async () => {
    expect(await forwardedFor(["198.51.100.66", "203.0.113.7"])).toBe("203.0.113.7");
  });

  it("forwards an IPv6 address", async () => {
    expect(clientAddressFrom(new Headers({ "x-forwarded-for": "198.51.100.1, 2001:db8::7" }))).toBe("2001:db8::7");
  });
});

describe("proxyRequest: errors, aborts, bounds", () => {
  it.each([
    ["400 for a bad path", 400, () => proxyRequest(proxied("x"), [".."], { token: TOKEN, backendBaseUrl: BACKEND, fetchImpl: upstream("{}") })],
    ["401 without a cookie", 401, () => proxyRequest(proxied("x"), ["x"], { token: null, backendBaseUrl: BACKEND, fetchImpl: upstream("{}") })],
    ["403 without the header", 403, () => proxyRequest(proxied("x", { noHeader: true }), ["x"], { token: TOKEN, backendBaseUrl: BACKEND, fetchImpl: upstream("{}") })],
    ["405 for OPTIONS", 405, () => proxyRequest(proxied("x", { method: "OPTIONS" }), ["x"], { token: TOKEN, backendBaseUrl: BACKEND, fetchImpl: upstream("{}") })],
    ["413 for a large body", 413, () => proxyRequest(proxied("x", { method: "POST", body: "xx" }), ["x"], { token: TOKEN, backendBaseUrl: BACKEND, fetchImpl: upstream("{}"), maxBodyBytes: 1 })],
    ["502 for an unreachable backend", 502, () => proxyRequest(proxied("x"), ["x"], { token: TOKEN, backendBaseUrl: BACKEND, fetchImpl: vi.fn(async () => { throw new TypeError("fetch failed"); }) })],
    ["502 for an unusable base URL", 502, () => proxyRequest(proxied("x"), ["x"], { token: TOKEN, backendBaseUrl: "not a url", fetchImpl: upstream("{}") })],
  ])("answers %s with cache-control no-store", async (_name, status, run) => {
    const response = await run();
    expect(response.status).toBe(status);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it.each([["not a url"], ["file:///etc/passwd"], ["javascript:alert(1)"]])(
    "answers 502 with a fixed message, without a backend call, for the base URL %s",
    async (backendBaseUrl) => {
      const fetchImpl = upstream("{}");
      const response = await proxyRequest(proxied("teams"), ["teams"], { token: TOKEN, backendBaseUrl, fetchImpl });
      expect(response.status).toBe(502);
      expect(await response.json()).toEqual({ error: "Backend not configured" });
      expect(fetchImpl).not.toHaveBeenCalled();
    },
  );

  it("answers 400 for a segment encodeURIComponent cannot encode (a lone surrogate)", async () => {
    const fetchImpl = upstream("{}");
    const response = await proxyRequest(proxied("x"), ["logs", "\uD800"], { token: TOKEN, backendBaseUrl: BACKEND, fetchImpl });
    expect(response.status).toBe(400);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("aborts the backend request when the browser's request is aborted", async () => {
    const controller = new AbortController();
    const fetchImpl = upstream("{}", { status: 200 });
    await proxyRequest(proxied("teams", { signal: controller.signal }), ["teams"], {
      token: TOKEN,
      backendBaseUrl: BACKEND,
      fetchImpl,
    });
    const signal = calledInit(fetchImpl).signal;
    expect(signal?.aborted).toBe(false);
    controller.abort();
    expect(signal?.aborted).toBe(true);
  });

  it.each([[205], [304]])("drops a body the backend sent with a %s", async (status) => {
    const stray = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("stray"));
        controller.close();
      },
    });
    const fetchImpl = vi.fn(async () => ({ status, statusText: "", headers: new Headers(), body: stray }) as unknown as Response);
    const response = await proxyRequest(proxied("teams"), ["teams"], { token: TOKEN, backendBaseUrl: BACKEND, fetchImpl });

    expect(response.status).toBe(status);
    expect(response.body).toBeNull();
  });

  it("cancels the browser's body stream once it grows past the limit", async () => {
    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new Uint8Array(10));
      },
      cancel,
    });
    const request = proxied("sources", { method: "POST", body: stream, duplex: "half" } as RequestInit);
    const response = await proxyRequest(request, ["sources"], {
      token: TOKEN,
      backendBaseUrl: BACKEND,
      fetchImpl: upstream("{}"),
      maxBodyBytes: 15,
    });

    expect(response.status).toBe(413);
    expect(cancel).toHaveBeenCalledTimes(1);
  });
});
