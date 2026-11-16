#!/usr/bin/env node
// Starts the production build (`next start`, run `npm run build` first) against
// a stub backend, loads every page of the app with a known session cookie and
// fails when the token value appears in a page's HTML or in its RSC payload
// (the flight data a client navigation fetches with the `RSC: 1` header). It
// also drives the API proxy end to end: the stub backend must see the token as
// the Authorization header, and the proxy must refuse a request without the
// cookie or without its header.
//
// The page list comes from src/app/**/page.tsx: a page without an entry in
// `pages` below fails the check, so a new page is either checked or listed as an
// exception on purpose. Each entry names a marker from the stub data that must
// appear in the page's HTML or RSC payload, so a page that rendered only an
// error boundary cannot pass.
//
// There is no exception: the live tail on the logs page authenticates its
// EventSource with a one-time stream ticket it fetches through the proxy, so
// that page is held to the same rule. (A page entry with `leak: true` would
// list a known exception and assert that it still leaks; none has one.)
//
// It also checks that the admin pages do not trust the readable user cookie:
// with a token the backend says belongs to a plain user, a user cookie that
// claims ADMIN is sent away from /admin and gets no Admin link, and the ticket
// request goes through the proxy with the token as the Authorization header.
//
// Ports: CHECK_FRONTEND_PORT and CHECK_BACKEND_PORT, or free ports when unset.
// Exit 0 when every check passes, 1 otherwise.

import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readdirSync } from "node:fs";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const FRONTEND_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const APP_DIR = path.join(FRONTEND_DIR, "src", "app");
const SECRET = `sess_check_${randomBytes(16).toString("hex")}`;
// A second session whose backend user is a plain USER, for the forged cookie.
const PLAIN_SECRET = `sess_plain_${randomBytes(16).toString("hex")}`;
const OVERALL_TIMEOUT_MS = 180_000;
const READY_TIMEOUT_MS = 60_000;
const KILL_GRACE_MS = 3_000;
const PROXY_BASE = "/bff";

const TEAM_MARKER = "Check Team Marker";
const team = { id: "team-check", name: TEAM_MARKER, slug: "check-team", role: "OWNER", createdAt: "2026-01-01T00:00:00.000Z" };
const user = { id: "user-check", email: "check@example.test", name: "Check", role: "ADMIN" };

const plainUser = { id: "user-plain", email: "plain@example.test", name: "Plain", role: "USER", status: "ACTIVE" };

const routes = {
  "/api/v1/teams": { teams: [team] },
  "/api/v1/dashboards/overview": {
    overview: { totalLogs: 3, errorRate: 0, services: [{ service: "check-service-marker", count: 3 }], recentIncidents: [] },
  },
  "/api/v1/sources": {
    sources: [{ id: "src-check", teamId: team.id, name: "check-source-marker", type: "HTTP", retentionDays: 30, keyHint: "abcd" }],
  },
  "/api/v1/alerts/rules": {
    rules: [
      {
        id: "rule-check",
        name: "check-rule-marker",
        query: "level:error",
        condition: "GREATER_THAN",
        threshold: 5,
        windowMinutes: 5,
        enabled: true,
      },
    ],
  },
  "/api/v1/alerts/incidents": { incidents: [] },
  "/api/v1/subscriptions": { subscriptions: [] },
  "/api/v1/admin/users": {
    users: [
      {
        id: "user-listed",
        email: "admin-list-marker@example.test",
        name: "Listed",
        role: "USER",
        status: "ACTIVE",
        createdAt: "2026-01-01T00:00:00.000Z",
        teams: [],
      },
    ],
  },
  "/api/v1/admin/teams": { teams: [] },
  "/api/v1/issues": { issues: [], total: 0 },
};

// Keyed by the route as the app directory spells it (route groups removed).
// `url` fills in dynamic segments; `marker` must appear in the HTML or RSC.
const pages = {
  "/": { marker: TEAM_MARKER, leak: false },
  "/dashboards": { marker: "check-service-marker", leak: false },
  "/settings": { marker: "check-source-marker", leak: false },
  "/alerts": { marker: "check-rule-marker", leak: false },
  "/alerts/subscriptions": { marker: "check-rule-marker", leak: false },
  "/admin": { marker: "admin-list-marker@example.test", leak: false },
  "/issues": { marker: TEAM_MARKER, leak: false },
  "/logs": { marker: TEAM_MARKER, leak: false },
  "/logs/search": { marker: TEAM_MARKER, leak: false },
  "/logs/[id]": { url: "/logs/log-1", marker: TEAM_MARKER, leak: false },
  "/login": { marker: '"registrationMode":"approval"', leak: false },
  "/register": { marker: '"registrationMode":"approval"', leak: false },
};

const failures = [];
const seenRequests = [];
let frontendChild = null;

function fail(message) {
  failures.push(message);
  console.error(`FAIL ${message}`);
}

function pass(message) {
  console.log(`ok   ${message}`);
}

/** Every route under src/app that has a page.tsx, with route groups removed. */
function discoverRoutes(dir = APP_DIR, segments = []) {
  const found = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      const isGroup = entry.name.startsWith("(") && entry.name.endsWith(")");
      found.push(...discoverRoutes(path.join(dir, entry.name), isGroup ? segments : [...segments, entry.name]));
    } else if (entry.name === "page.tsx") {
      found.push(`/${segments.join("/")}`);
    }
  }
  return found.sort();
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

function startBackend(port) {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://stub");
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      seenRequests.push({
        method: req.method,
        path: url.pathname,
        authorization: req.headers.authorization ?? null,
        forwardedFor: req.headers["x-forwarded-for"] ?? null,
        body: Buffer.concat(chunks).toString("utf8"),
      });
      res.setHeader("content-type", "application/json");
      if (url.pathname === "/api/v1/auth/settings") {
        res.end(JSON.stringify({ registrationMode: "approval" }));
        return;
      }
      const isAdminSession = req.headers.authorization === `Bearer ${SECRET}`;
      const isPlainSession = req.headers.authorization === `Bearer ${PLAIN_SECRET}`;
      if (!isAdminSession && !isPlainSession) {
        res.statusCode = 401;
        res.end(JSON.stringify({ error: "Unauthorized" }));
        return;
      }
      if (url.pathname === "/api/v1/auth/me") {
        res.end(JSON.stringify({ user: isAdminSession ? user : plainUser }));
        return;
      }
      if (url.pathname.startsWith("/api/v1/admin/") && !isAdminSession) {
        res.statusCode = 403;
        res.end(JSON.stringify({ error: "Admin access required" }));
        return;
      }
      if (url.pathname === "/api/v1/stream/ticket" && req.method === "POST") {
        res.statusCode = 201;
        res.end(JSON.stringify({ ticket: "stub-ticket-1", expiresInSeconds: 60 }));
        return;
      }
      const body = routes[url.pathname];
      if (!body) {
        res.statusCode = 404;
        res.end(JSON.stringify({ error: "Not found" }));
        return;
      }
      res.end(JSON.stringify(body));
    });
  });
  return new Promise((resolve) => server.listen(port, "127.0.0.1", () => resolve(server)));
}

function startFrontend(port, backendPort) {
  const child = spawn(
    process.execPath,
    [path.join(FRONTEND_DIR, "node_modules/next/dist/bin/next"), "start", "-p", String(port), "-H", "127.0.0.1"],
    {
      cwd: FRONTEND_DIR,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        NODE_ENV: "production",
        INTERNAL_API_BASE_URL: `http://127.0.0.1:${backendPort}/api/v1`,
      },
    },
  );
  let output = "";
  child.stdout.on("data", (chunk) => (output += chunk));
  child.stderr.on("data", (chunk) => (output += chunk));
  frontendChild = child;
  return { child, output: () => output };
}

function signalGroup(child, signal) {
  try {
    process.kill(-child.pid, signal);
  } catch {
    /* the group is gone */
  }
}

/** TERM to the whole process group of `next start`, KILL after a short grace. */
async function stopFrontend(child) {
  if (!child) return;
  if (child.exitCode !== null || child.signalCode !== null) {
    // The leader is gone; KILL whatever is left of its group.
    signalGroup(child, "SIGKILL");
    return;
  }
  const exited = new Promise((resolve) => child.once("exit", resolve));
  signalGroup(child, "SIGTERM");
  const timer = new Promise((resolve) => setTimeout(resolve, KILL_GRACE_MS, "timeout"));
  if ((await Promise.race([exited, timer])) === "timeout") signalGroup(child, "SIGKILL");
  // A child of next start can outlive its parent's exit; KILL the group either way.
  signalGroup(child, "SIGKILL");
}

for (const [signal, code] of [
  ["SIGINT", 130],
  ["SIGTERM", 143],
]) {
  process.on(signal, () => {
    console.error(`check-token-absent: ${signal}, stopping next start`);
    stopFrontend(frontendChild).finally(() => process.exit(code));
  });
}

async function waitForReady(base, deadline) {
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${base}/login`, { redirect: "manual" });
      if (response.status === 200) return true;
    } catch {
      /* not listening yet */
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return false;
}

const cookie = `telerithm_token=${SECRET}; telerithm_user=${encodeURIComponent(JSON.stringify(user))}`;

async function checkPage(base, route, page) {
  const url = page.url ?? route;
  const html = await fetch(`${base}${url}`, { headers: { cookie }, redirect: "manual" });
  const htmlText = await html.text();
  const rsc = await fetch(`${base}${url}`, { headers: { cookie, RSC: "1" }, redirect: "manual" });
  const rscText = await rsc.text();

  if (html.status !== 200 || rsc.status !== 200) {
    fail(`${url}: expected 200 for HTML and RSC, got ${html.status} and ${rsc.status}`);
    return;
  }
  const rscType = rsc.headers.get("content-type") ?? "";
  if (!rscType.startsWith("text/x-component")) {
    fail(`${url}: the RSC request answered ${rscType || "no content type"}, not text/x-component`);
    return;
  }
  if (!htmlText.includes(page.marker) && !rscText.includes(page.marker)) {
    fail(`${url}: the stub data marker ${page.marker} is in neither HTML nor RSC, so the check proves nothing`);
    return;
  }

  const inHtml = htmlText.includes(SECRET);
  const inRsc = rscText.includes(SECRET);
  if (page.leak) {
    if (inHtml || inRsc) pass(`${url}: token present, the known live tail exception`);
    else fail(`${url}: the live tail exception no longer holds; set leak: false for this page`);
    return;
  }
  if (inHtml) fail(`${url}: token found in the HTML`);
  if (inRsc) fail(`${url}: token found in the RSC payload`);
  if (!inHtml && !inRsc) pass(`${url}: token absent from HTML (${htmlText.length} chars) and RSC (${rscText.length} chars)`);
}

async function checkProxy(base) {
  seenRequests.length = 0;
  const ok = await fetch(`${base}${PROXY_BASE}/teams`, {
    headers: { cookie, "x-telerithm-proxy": "1", "x-forwarded-for": "198.51.100.66, 203.0.113.7" },
  });
  const okBody = await ok.text();
  const reached = seenRequests.find((entry) => entry.path === "/api/v1/teams");
  if (ok.status === 200 && okBody.includes(team.id) && reached?.authorization === `Bearer ${SECRET}`) {
    pass("proxy: forwards the cookie token as the Authorization header");
  } else {
    fail(`proxy: expected 200 with the stub teams and a Bearer header, got ${ok.status} (${okBody.slice(0, 80)})`);
  }
  if (reached?.forwardedFor === "203.0.113.7") pass("proxy: forwards only the rightmost X-Forwarded-For entry");
  else fail(`proxy: expected X-Forwarded-For 203.0.113.7 at the backend, got ${reached?.forwardedFor}`);
  if (okBody.includes(SECRET)) fail("proxy: the response body carries the token");

  const noCookie = await fetch(`${base}${PROXY_BASE}/teams`, { headers: { "x-telerithm-proxy": "1" }, redirect: "manual" });
  if (noCookie.status === 401) pass("proxy: 401 without the session cookie (no redirect to /login)");
  else fail(`proxy: expected 401 without the cookie, got ${noCookie.status}`);

  const noHeader = await fetch(`${base}${PROXY_BASE}/teams`, { headers: { cookie } });
  if (noHeader.status === 403) pass("proxy: 403 without the proxy header");
  else fail(`proxy: expected 403 without the proxy header, got ${noHeader.status}`);

  const preflight = await fetch(`${base}${PROXY_BASE}/teams`, {
    method: "OPTIONS",
    headers: { origin: "https://evil.example", "access-control-request-headers": "x-telerithm-proxy" },
  });
  if (preflight.status === 405 && preflight.headers.get("access-control-allow-origin") === null) {
    pass("proxy: a CORS preflight gets 405 without CORS headers");
  } else {
    fail(`proxy: expected 405 without CORS headers for a preflight, got ${preflight.status}`);
  }
}

async function checkStreamTicket(base) {
  seenRequests.length = 0;
  const response = await fetch(`${base}${PROXY_BASE}/stream/ticket`, {
    method: "POST",
    headers: { cookie, "x-telerithm-proxy": "1", "content-type": "application/json" },
    body: JSON.stringify({ teamId: team.id }),
  });
  const text = await response.text();
  const reached = seenRequests.find((entry) => entry.path === "/api/v1/stream/ticket");
  if (
    response.status === 201 &&
    text.includes("stub-ticket-1") &&
    reached?.method === "POST" &&
    reached.authorization === `Bearer ${SECRET}` &&
    JSON.parse(reached.body).teamId === team.id
  ) {
    pass("stream ticket: POST through the proxy reaches the backend with the cookie token as the Authorization header");
  } else {
    fail(`stream ticket: expected 201 with the stub ticket and a Bearer header at the backend, got ${response.status} (${text.slice(0, 80)})`);
  }
  if (text.includes(SECRET)) fail("stream ticket: the response body carries the session token");

  const noCookie = await fetch(`${base}${PROXY_BASE}/stream/ticket`, {
    method: "POST",
    headers: { "x-telerithm-proxy": "1", "content-type": "application/json" },
    body: JSON.stringify({ teamId: team.id }),
  });
  if (noCookie.status === 401) pass("stream ticket: 401 without the session cookie");
  else fail(`stream ticket: expected 401 without the cookie, got ${noCookie.status}`);
}

async function checkAdminGate(base) {
  // The cookie claims ADMIN; the backend says this token is a plain user.
  const forgedCookie = `telerithm_token=${PLAIN_SECRET}; telerithm_user=${encodeURIComponent(JSON.stringify({ ...user, role: "ADMIN" }))}`;
  seenRequests.length = 0;
  const admin = await fetch(`${base}/admin`, { headers: { cookie: forgedCookie }, redirect: "manual" });
  const adminText = await admin.text();
  const location = admin.headers.get("location");
  const target = location ? new URL(location, base).pathname : null;
  // The page redirects from a server component while the layout is already
  // streaming, so Next answers 200 with a meta refresh to / rather than a 307.
  const refreshesHome = /<meta[^>]*http-equiv="refresh"[^>]*content="[0-9]+;url=\/"/.test(adminText);
  const redirected = target === "/" || refreshesHome;
  if (redirected && !adminText.includes("admin-list-marker@example.test") && !adminText.includes("User management")) {
    pass("admin gate: a user cookie forged to ADMIN is sent to / and the admin page is not rendered");
  } else {
    fail(`admin gate: expected a redirect to / and no admin page for the forged cookie, got ${admin.status} (location ${location})`);
  }
  if (seenRequests.some((entry) => entry.path === "/api/v1/admin/users")) {
    fail("admin gate: the frontend asked the backend for the user list on behalf of a forged cookie");
  }

  const home = await fetch(`${base}/`, { headers: { cookie: forgedCookie }, redirect: "manual" });
  const homeText = await home.text();
  if (home.status === 200 && !homeText.includes('href="/admin"')) pass("admin gate: no Admin link for the forged cookie");
  else fail(`admin gate: expected a page without the Admin link for the forged cookie, got ${home.status}`);

  const realHome = await fetch(`${base}/`, { headers: { cookie }, redirect: "manual" });
  const realHomeText = await realHome.text();
  if (realHome.status === 200 && realHomeText.includes('href="/admin"')) pass("admin gate: the real admin sees the Admin link");
  else fail(`admin gate: expected the Admin link for the real admin, got ${realHome.status} (control)`);
}

async function main() {
  const discovered = discoverRoutes();
  for (const route of discovered) {
    if (!pages[route]) fail(`${route}: page not covered; add it to pages (checked or a listed exception)`);
  }
  for (const route of Object.keys(pages)) {
    if (!discovered.includes(route)) fail(`${route}: listed in pages but no such page.tsx exists`);
  }

  const frontendPort = Number(process.env.CHECK_FRONTEND_PORT) || (await freePort());
  const backendPort = Number(process.env.CHECK_BACKEND_PORT) || (await freePort());
  const backend = await startBackend(backendPort);
  const frontend = startFrontend(frontendPort, backendPort);
  const base = `http://127.0.0.1:${frontendPort}`;
  const timer = setTimeout(() => {
    console.error("FAIL overall timeout");
    stopFrontend(frontend.child).finally(() => process.exit(1));
  }, OVERALL_TIMEOUT_MS);

  try {
    if (!(await waitForReady(base, Date.now() + READY_TIMEOUT_MS))) {
      fail(`next start did not answer on ${base}/login\n${frontend.output()}`);
      return;
    }
    for (const route of discovered) if (pages[route]) await checkPage(base, route, pages[route]);
    await checkProxy(base);
    await checkStreamTicket(base);
    await checkAdminGate(base);
  } finally {
    clearTimeout(timer);
    await stopFrontend(frontend.child);
    backend.close();
  }
}

await main();
if (failures.length > 0) {
  console.error(`${failures.length} check(s) failed`);
  process.exit(1);
}
console.log("all checks passed");
