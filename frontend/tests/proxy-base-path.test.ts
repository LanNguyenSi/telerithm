// @vitest-environment node
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { config, middleware } from "@/middleware";
import { PROXY_BASE_PATH } from "@/lib/api/proxy-constants";
import { NextRequest } from "next/server";

// The edge proxy routes `/api` (PathPrefix in docker-compose.traefik.yml) to the
// backend, which mounts its routes under /api/v1. A browser proxy under `/api`
// would therefore never reach the frontend in production.
const REPO_ROOT = path.resolve(__dirname, "../..");

function composePathPrefixes(): string[] {
  const prefixes: string[] = [];
  for (const file of readdirSync(REPO_ROOT).filter((name) => /^docker-compose.*\.ya?ml$/.test(name))) {
    const text = readFileSync(path.join(REPO_ROOT, file), "utf8");
    for (const match of text.matchAll(/PathPrefix\(`([^`]+)`\)/g)) prefixes.push(match[1]);
  }
  return prefixes;
}

describe("proxy base path", () => {
  it("does not start with /api, the backend's public prefix", () => {
    expect(PROXY_BASE_PATH.startsWith("/api")).toBe(false);
  });

  it("is not caught by any PathPrefix rule of the compose files", () => {
    const prefixes = composePathPrefixes();
    expect(prefixes).toContain("/api");
    for (const prefix of prefixes) expect(PROXY_BASE_PATH.startsWith(prefix)).toBe(false);
  });

  it("lies outside the middleware matcher, so a request without cookie reaches the proxy's 401", () => {
    const matcher = new RegExp(`^${config.matcher[0]}$`);
    expect(matcher.test(`${PROXY_BASE_PATH}/teams`)).toBe(false);
    expect(matcher.test("/settings")).toBe(true);
  });

  it.each([["/bff"], ["/bff/x"], ["/api"], ["/api/x"]])("the matcher skips %s", (pathname) => {
    expect(new RegExp(`^${config.matcher[0]}$`).test(pathname)).toBe(false);
  });

  it.each([["/bffx"], ["/bff-settings"], ["/apix"], ["/api-docs"]])(
    "the matcher still runs the middleware for %s (the exclusion stops at a segment boundary)",
    (pathname) => {
      expect(new RegExp(`^${config.matcher[0]}$`).test(pathname)).toBe(true);
    },
  );

  it("the middleware itself would redirect a cookieless request, which is why the matcher must skip the proxy", () => {
    const response = middleware(new NextRequest(`http://localhost${PROXY_BASE_PATH}/teams`));
    expect(response.status).toBe(307);
  });
});
