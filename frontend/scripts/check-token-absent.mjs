#!/usr/bin/env node
// Starts the production build (`next start`, run `npm run build` first) against
// a stub backend, loads the authenticated pages with a known session cookie and
// fails when the token value appears in a page's HTML or in its RSC payload
// (the flight data a client navigation fetches with the `RSC: 1` header). It
// also drives the API proxy end to end: the stub backend must see the token as
// the Authorization header, and the proxy must refuse a request without the
// cookie or without its header.
//
// The logs page is the one known exception: its live tail still authenticates
// the EventSource with the token in the stream URL. The check asserts that the
// exception is still the only one; when live tail stops needing the token, flip
// its entry to `leak: false`.
//
// Ports: CHECK_FRONTEND_PORT and CHECK_BACKEND_PORT, or free ports when unset.
// Exit 0 when every check passes, 1 otherwise.

import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const FRONTEND_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SECRET = `sess_check_${randomBytes(16).toString("hex")}`;
const OVERALL_TIMEOUT_MS = 180_000;
const READY_TIMEOUT_MS = 60_000;

const team = { id: "team-check", name: "Check Team", slug: "check-team", role: "OWNER", createdAt: "2026-01-01T00:00:00.000Z" };
const user = { id: "user-check", email: "check@example.test", name: "Check", role: "ADMIN" };

const routes = {
  "/api/v1/teams": { teams: [team] },
  "/api/v1/dashboards/overview": { overview: { totalLogs: 3, errorRate: 0, services: [], recentIncidents: [] } },
  "/api/v1/sources": {
    sources: [{ id: "src-check", teamId: team.id, name: "check-source-name", type: "HTTP", retentionDays: 30, keyHint: "abcd" }],
  },
  "/api/v1/alerts/rules": { rules: [] },
  "/api/v1/alerts/incidents": { incidents: [] },
  "/api/v1/subscriptions": { subscriptions: [] },
  "/api/v1/admin/users": { users: [] },
  "/api/v1/admin/teams": { teams: [] },
  "/api/v1/issues": { issues: [], total: 0 },
};

const pages = [
  { path: "/", leak: false },
  { path: "/dashboards", leak: false },
  { path: "/settings", leak: false, mustContain: "check-source-name" },
  { path: "/alerts", leak: false },
  { path: "/alerts/subscriptions", leak: false },
  { path: "/admin", leak: false },
  { path: "/issues", leak: false },
  { path: "/logs/search", leak: false },
  { path: "/logs/log-1", leak: false },
  { path: "/logs", leak: true },
];

const failures = [];
const seenAuthorization = [];

function fail(message) {
  failures.push(message);
  console.error(`FAIL ${message}`);
}

function pass(message) {
  console.log(`ok   ${message}`);
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
    seenAuthorization.push({ path: url.pathname, authorization: req.headers.authorization ?? null });
    res.setHeader("content-type", "application/json");
    if (url.pathname === "/api/v1/auth/settings") {
      res.end(JSON.stringify({ registrationMode: "open" }));
      return;
    }
    if (req.headers.authorization !== `Bearer ${SECRET}`) {
      res.statusCode = 401;
      res.end(JSON.stringify({ error: "Unauthorized" }));
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
  return { child, output: () => output };
}

function stopFrontend(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    /* already gone */
  }
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

async function checkPage(base, page) {
  const html = await fetch(`${base}${page.path}`, { headers: { cookie }, redirect: "manual" });
  const htmlText = await html.text();
  const rsc = await fetch(`${base}${page.path}`, { headers: { cookie, RSC: "1" }, redirect: "manual" });
  const rscText = await rsc.text();

  if (html.status !== 200 || rsc.status !== 200) {
    fail(`${page.path}: expected 200 for HTML and RSC, got ${html.status} and ${rsc.status}`);
    return;
  }
  if (page.mustContain && !htmlText.includes(page.mustContain)) {
    fail(`${page.path}: the page did not render the stub data (${page.mustContain}), so the check proves nothing`);
    return;
  }

  const inHtml = htmlText.includes(SECRET);
  const inRsc = rscText.includes(SECRET);
  if (page.leak) {
    if (inHtml || inRsc) pass(`${page.path}: token present, the known live tail exception`);
    else fail(`${page.path}: the live tail exception no longer holds; set leak: false for this page`);
    return;
  }
  if (inHtml) fail(`${page.path}: token found in the HTML`);
  if (inRsc) fail(`${page.path}: token found in the RSC payload`);
  if (!inHtml && !inRsc) pass(`${page.path}: token absent from HTML (${htmlText.length} chars) and RSC (${rscText.length} chars)`);
}

async function checkProxy(base) {
  seenAuthorization.length = 0;
  const ok = await fetch(`${base}/api/proxy/teams`, { headers: { cookie, "x-telerithm-proxy": "1" } });
  const okBody = await ok.text();
  const reached = seenAuthorization.find((entry) => entry.path === "/api/v1/teams");
  if (ok.status === 200 && okBody.includes(team.id) && reached?.authorization === `Bearer ${SECRET}`) {
    pass("proxy: forwards the cookie token as the Authorization header");
  } else {
    fail(`proxy: expected 200 with the stub teams and a Bearer header, got ${ok.status} (${okBody.slice(0, 80)})`);
  }
  if (okBody.includes(SECRET)) fail("proxy: the response body carries the token");

  const noCookie = await fetch(`${base}/api/proxy/teams`, { headers: { "x-telerithm-proxy": "1" } });
  if (noCookie.status === 401) pass("proxy: 401 without the session cookie");
  else fail(`proxy: expected 401 without the cookie, got ${noCookie.status}`);

  const noHeader = await fetch(`${base}/api/proxy/teams`, { headers: { cookie } });
  if (noHeader.status === 403) pass("proxy: 403 without the proxy header");
  else fail(`proxy: expected 403 without the proxy header, got ${noHeader.status}`);
}

async function main() {
  const frontendPort = Number(process.env.CHECK_FRONTEND_PORT) || (await freePort());
  const backendPort = Number(process.env.CHECK_BACKEND_PORT) || (await freePort());
  const backend = await startBackend(backendPort);
  const frontend = startFrontend(frontendPort, backendPort);
  const base = `http://127.0.0.1:${frontendPort}`;
  const deadline = Date.now() + READY_TIMEOUT_MS;
  const timer = setTimeout(() => {
    console.error("FAIL overall timeout");
    stopFrontend(frontend.child);
    process.exit(1);
  }, OVERALL_TIMEOUT_MS);

  try {
    if (!(await waitForReady(base, deadline))) {
      fail(`next start did not answer on ${base}/login\n${frontend.output()}`);
      return;
    }
    for (const page of pages) await checkPage(base, page);
    await checkProxy(base);
  } finally {
    clearTimeout(timer);
    stopFrontend(frontend.child);
    backend.close();
  }
}

await main();
if (failures.length > 0) {
  console.error(`${failures.length} check(s) failed`);
  process.exit(1);
}
console.log("all checks passed");
