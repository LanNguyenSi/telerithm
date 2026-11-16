// Shared by the browser API client and the proxy route handler. Kept free of
// server-only imports so client components can import it.

/** Same-origin path under which the browser reaches the backend API. */
export const PROXY_BASE_PATH = "/api/proxy";

/**
 * Every proxied request must carry this header. A cross-site page cannot set a
 * custom header without a CORS preflight, which the proxy never answers, so a
 * forged form post or image request that only carries the session cookie is
 * refused.
 */
export const PROXY_HEADER = "x-telerithm-proxy";
