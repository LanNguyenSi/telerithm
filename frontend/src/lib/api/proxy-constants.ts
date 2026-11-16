// Shared by the browser API client and the proxy route handler. Kept free of
// server-only imports so client components can import it.

/**
 * Same-origin path under which the browser reaches the backend API. It must
 * stay outside `/api`: the edge proxy sends every `/api` request straight to
 * the backend (see the router rules in docker-compose.traefik.yml), so a proxy
 * under `/api` would never reach the frontend.
 */
export const PROXY_BASE_PATH = "/bff";

/**
 * Every proxied request must carry this header. A cross-site page can only send
 * a custom header after a CORS preflight, and the proxy answers OPTIONS with 405
 * and no CORS headers, so the preflight fails. A forged form post or image
 * request that only carries the session cookie is refused with 403.
 */
export const PROXY_HEADER = "x-telerithm-proxy";
