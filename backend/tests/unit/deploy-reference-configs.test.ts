/**
 * The reference log-shipper configs under deploy/ must not give a host root
 * lever or an open unauthenticated port to someone who copies them to a server:
 * the Fluentd forward input binds loopback, and any service that mounts the
 * Docker socket sits behind an opt-in compose profile.
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

function read(rel: string): string {
  return readFileSync(resolve(repoRoot, rel), "utf8");
}

/** Drop whole-line and trailing `#` comments (Fluentd and YAML); the `#{...}` Ruby interpolation is kept. */
function activeLines(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.replace(/(^|\s)#(?!\{).*$/, ""))
    .filter((line) => line.trim() !== "");
}

/** Top-level service blocks of a compose file: name -> its raw lines (indented body). */
function composeServices(text: string): Map<string, string[]> {
  const lines = activeLines(text);
  const services = new Map<string, string[]>();
  let inServices = false;
  let current: string | null = null;
  for (const line of lines) {
    if (/^\S/.test(line)) {
      inServices = /^services:\s*$/.test(line);
      current = null;
      continue;
    }
    if (!inServices) continue;
    const m = /^ {2}([A-Za-z0-9_.-]+):\s*$/.exec(line);
    if (m) {
      current = m[1];
      services.set(current, []);
    } else if (current) {
      services.get(current)!.push(line);
    }
  }
  return services;
}

describe("deploy/fluentd/fluent.conf", () => {
  const active = activeLines(read("deploy/fluentd/fluent.conf"));

  it("binds the forward input to loopback", () => {
    const binds = active.filter((l) => /^\s*bind\s/.test(l)).map((l) => l.trim());
    expect(binds).toEqual(["bind 127.0.0.1"]);
  });

  it("does not bind 0.0.0.0 in any active line", () => {
    expect(active.some((l) => l.includes("0.0.0.0"))).toBe(false);
  });

  it("documents the shared-key option as a comment, not as active config", () => {
    const raw = read("deploy/fluentd/fluent.conf");
    expect(raw).toMatch(/^\s*#\s*<security>/m);
    expect(raw).toMatch(/^\s*#\s*shared_key\b.*ENV/m);
    expect(active.some((l) => /<security>|shared_key/.test(l))).toBe(false);
  });
});

describe("deploy/docker-compose.logging.yml", () => {
  const services = composeServices(read("deploy/docker-compose.logging.yml"));

  it("parses at least one service", () => {
    expect(services.size).toBeGreaterThan(0);
  });

  it("never mounts docker.sock in a service that starts by default", () => {
    for (const [name, body] of services) {
      const mountsSocket = body.some((l) => l.includes("docker.sock"));
      if (!mountsSocket) continue;
      const hasProfile = body.some((l) => /^ {4}profiles:\s*\[\s*\S.*\]\s*$/.test(l) || /^ {4}profiles:\s*$/.test(l));
      expect(hasProfile, `service ${name} mounts docker.sock without a profile`).toBe(true);
    }
  });

  it("publishes no port on all interfaces", () => {
    for (const [name, body] of services) {
      for (const line of body) {
        if (/^\s*-\s*["']?\d+:\d+/.test(line) || /^\s*-\s*["']?0\.0\.0\.0:/.test(line)) {
          throw new Error(`service ${name} publishes a port without a loopback address: ${line.trim()}`);
        }
      }
    }
  });
});
