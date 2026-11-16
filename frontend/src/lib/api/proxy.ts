import { PROXY_HEADER } from "./proxy-constants";

// Same-origin proxy from the browser to the backend API. The browser never
// holds the session token: the route handler reads it from the httpOnly cookie
// and this module attaches it as the Authorization header. Kept free of Next
// imports so it can be tested with plain Request objects.

/** Largest request body the proxy forwards (the API's own JSON limit is larger). */
export const MAX_PROXY_BODY_BYTES = 1024 * 1024;

const ALLOWED_METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE"]);

// Only these request headers reach the backend. Cookie, Authorization, Host and
// the forwarding headers of the incoming request are never passed on.
const FORWARDED_REQUEST_HEADERS = ["accept", "accept-language", "content-type"];

// Only these response headers come back. Content-Encoding and Content-Length are
// left out on purpose: fetch has already decoded the body, so both would be wrong.
const FORWARDED_RESPONSE_HEADERS = [
  "cache-control",
  "content-disposition",
  "content-type",
  "ratelimit",
  "ratelimit-policy",
  "retry-after",
  "x-request-id",
];

export interface ProxyOptions {
  /** Session token from the httpOnly cookie, or null when there is none. */
  token: string | null;
  /** Fixed backend API base URL from server configuration, never from the request. */
  backendBaseUrl: string;
  fetchImpl?: typeof fetch;
  maxBodyBytes?: number;
}

function errorResponse(status: number, error: string): Response {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

/**
 * The backend URL for the path segments of a proxied request, or null when a
 * segment could leave the API base path. Each segment is percent-encoded on its
 * own, so a segment can never add a path separator, a scheme or a host.
 */
export function buildBackendUrl(backendBaseUrl: string, segments: readonly string[], search: string): URL | null {
  if (segments.length === 0) return null;
  for (const segment of segments) {
    if (segment === "" || segment === "." || segment === "..") return null;
    if (/[/\\]/.test(segment)) return null;
    // eslint-disable-next-line no-control-regex
    if (/[\u0000-\u001f\u007f]/.test(segment)) return null;
  }

  const base = new URL(backendBaseUrl);
  const basePath = base.pathname.replace(/\/+$/, "");
  const target = new URL(base.origin);
  target.pathname = `${basePath}/${segments.map((segment) => encodeURIComponent(segment)).join("/")}`;
  target.search = search;

  if (target.origin !== base.origin || !target.pathname.startsWith(`${basePath}/`)) return null;
  return target;
}

const TOO_LARGE = Symbol("too-large");

async function readBoundedBody(request: Request, maxBytes: number): Promise<Uint8Array<ArrayBuffer> | null | typeof TOO_LARGE> {
  const declared = request.headers.get("content-length");
  if (declared !== null && Number(declared) > maxBytes) return TOO_LARGE;
  if (!request.body) return null;

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      return TOO_LARGE;
    }
    chunks.push(value);
  }
  if (total === 0) return null;

  const body = new Uint8Array(new ArrayBuffer(total));
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

export async function proxyRequest(
  request: Request,
  segments: readonly string[],
  options: ProxyOptions,
): Promise<Response> {
  const method = request.method.toUpperCase();
  if (!ALLOWED_METHODS.has(method)) return errorResponse(405, "Method not allowed");

  if (request.headers.get(PROXY_HEADER) !== "1") return errorResponse(403, "Missing proxy header");

  if (!options.token) return errorResponse(401, "Not authenticated");

  const target = buildBackendUrl(options.backendBaseUrl, segments, new URL(request.url).search);
  if (!target) return errorResponse(400, "Invalid API path");

  // A GET request has no body stream, so this is null for it.
  const body = await readBoundedBody(request, options.maxBodyBytes ?? MAX_PROXY_BODY_BYTES);
  if (body === TOO_LARGE) return errorResponse(413, "Request body too large");

  const headers = new Headers();
  for (const name of FORWARDED_REQUEST_HEADERS) {
    const value = request.headers.get(name);
    if (value !== null) headers.set(name, value);
  }
  headers.set("authorization", `Bearer ${options.token}`);

  let upstream: Response;
  try {
    upstream = await (options.fetchImpl ?? fetch)(target, {
      method,
      headers,
      body: body ?? undefined,
      // A redirect from the backend is passed back, never followed to another host.
      redirect: "manual",
      cache: "no-store",
      signal: request.signal,
    });
  } catch {
    return errorResponse(502, "Backend unreachable");
  }

  if (upstream.status < 200 || upstream.status > 599) return errorResponse(502, "Unexpected backend response");

  const responseHeaders = new Headers();
  for (const name of FORWARDED_RESPONSE_HEADERS) {
    const value = upstream.headers.get(name);
    if (value !== null) responseHeaders.set(name, value);
  }
  if (!responseHeaders.has("cache-control")) responseHeaders.set("cache-control", "no-store");

  const noBody = upstream.status === 204 || upstream.status === 205 || upstream.status === 304;
  // The upstream body is passed on as a stream, so a streaming response reaches
  // the browser as it arrives.
  return new Response(noBody ? null : upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: responseHeaders,
  });
}
