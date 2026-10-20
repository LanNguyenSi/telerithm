import http from "node:http";
import https from "node:https";
import type { LookupFunction } from "node:net";
import { resolveSafeTarget, type GuardDeps, type SafeTarget } from "./url-guard.js";

/**
 * The only way a notification sender may send an HTTP request to a
 * user-supplied URL.
 *
 * `resolveSafeTarget` resolves the host name once and range-checks every
 * address; the request is then made with a connect-time `lookup` that answers
 * from that vetted set and never asks DNS again. A host that answers public
 * first and private second (DNS rebinding) therefore cannot steer the
 * connection: the second answer is never requested. The URL keeps its host
 * name, so the Host header, the TLS SNI name and the certificate check all
 * stay on the original name; only the address the socket dials is pinned.
 *
 * Implemented on node:http and node:https instead of the global fetch so no
 * dispatcher version has to match the Node runtime's bundled HTTP client.
 * Neither follows redirects, so a 3xx comes back as a (non-ok) response and
 * can never bounce the request to a host the guard did not see. The proxy
 * environment variables are not consulted either, so a request cannot be
 * routed past the pinned address.
 */

export interface SafeFetchInit {
  method: "POST" | "GET";
  headers?: Record<string, string>;
  body?: string;
  /** Covers connect, request and response headers. Defaults to 10 s. */
  timeoutMs?: number;
}

export interface SafeFetchResponse {
  ok: boolean;
  status: number;
  statusText: string;
}

/** Seams for tests; the senders never pass this. */
export interface SafeFetchInternals {
  guard?: GuardDeps;
  /** Extra trust anchors for the https connection (a test CA). */
  ca?: string | Buffer;
}

const DEFAULT_TIMEOUT_MS = 10_000;

// Headers the HTTP client derives itself. fetch treats them as forbidden, so a
// subscriber-supplied value must not override the Host or the framing.
const MANAGED_HEADERS = new Set([
  "host",
  "content-length",
  "transfer-encoding",
  "connection",
  "expect",
  "upgrade",
]);

/**
 * A `lookup` for the socket that answers only from `addresses` and never asks
 * DNS. Exported for tests.
 */
export function pinnedLookup(addresses: string[]): LookupFunction {
  const entries = addresses.map((address) => ({ address, family: address.includes(":") ? 6 : 4 }));
  return (hostname, options, callback) => {
    const wanted = options.family === 4 || options.family === 6 ? options.family : 0;
    const usable = entries.filter((e) => wanted === 0 || e.family === wanted);
    if (usable.length === 0) {
      const err: NodeJS.ErrnoException = new Error(`No vetted address for ${hostname}`);
      err.code = "ENOTFOUND";
      callback(err, "", 0);
      return;
    }
    if (options.all) {
      callback(null, usable);
      return;
    }
    callback(null, usable[0].address, usable[0].family);
  };
}

function request(
  target: SafeTarget,
  init: SafeFetchInit,
  internals?: SafeFetchInternals,
): Promise<SafeFetchResponse> {
  const { url, hostname, addresses } = target;
  const isHttps = url.protocol === "https:";

  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(init.headers ?? {})) {
    if (!MANAGED_HEADERS.has(name.toLowerCase())) headers[name] = value;
  }

  const options: https.RequestOptions = {
    method: init.method,
    hostname,
    port: url.port === "" ? undefined : Number(url.port),
    path: `${url.pathname}${url.search}`,
    headers,
    // A fresh agent per request: no pooled socket from another request is
    // reused, and the socket is closed when the response is dropped.
    agent: false,
    signal: AbortSignal.timeout(init.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    // The only address source for the socket. Node skips it for an IP literal
    // and otherwise calls it instead of DNS; the TLS server name is derived
    // from the URL's host name, not from the address.
    lookup: pinnedLookup(addresses),
  };
  if (isHttps && internals?.ca !== undefined) options.ca = internals.ca;

  return new Promise<SafeFetchResponse>((resolve, reject) => {
    const req = (isHttps ? https : http).request(options, (res) => {
      const status = res.statusCode ?? 0;
      resolve({ ok: status >= 200 && status < 300, status, statusText: res.statusMessage ?? "" });
      // The body is not used; drop it so the socket is released.
      res.destroy();
    });
    req.on("error", reject);
    req.end(init.body);
  });
}

/**
 * Vet `rawUrl` with the SSRF guard and send one request to exactly the
 * addresses it vetted. Throws `ChannelConfigError` when the guard refuses the
 * URL; any other rejection is a network failure.
 */
export async function safeFetch(
  rawUrl: string,
  init: SafeFetchInit,
  internals?: SafeFetchInternals,
): Promise<SafeFetchResponse> {
  const target = await resolveSafeTarget(rawUrl, internals?.guard);
  return request(target, init, internals);
}
