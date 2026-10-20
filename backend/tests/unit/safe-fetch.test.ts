import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import http from "node:http";
import https from "node:https";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChannelConfigError } from "../../src/services/notification/channels/errors.js";

vi.mock("../../src/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), fatal: vi.fn() },
  createChildLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

import {
  pinnedLookup,
  safeFetch,
  type SafeFetchInternals,
} from "../../src/services/notification/safe-fetch.js";

// The name never resolves in real DNS (RFC 2606), so a connection that is not
// pinned to the vetted address cannot reach the observer server by accident.
const NAME = "rebind.example.invalid";
const PUBLIC_FIRST = "127.0.0.1"; // stands in for the public address; the observer listens here
const PRIVATE_SECOND = "10.0.0.99";

/** Guard seams: the observer lives on loopback, so only 10/8 counts as private here. */
function guardWith(answers: string[][]) {
  const lookup = vi.fn(async (_host: string) => {
    const next = answers[Math.min(lookup.mock.calls.length - 1, answers.length - 1)];
    return next.map((address) => ({ address }));
  });
  const internals: SafeFetchInternals = {
    guard: { lookup, isBlockedAddress: (ip) => ip.startsWith("10.") },
  };
  return { lookup, internals };
}

interface Seen {
  method?: string;
  url?: string;
  headers: http.IncomingHttpHeaders;
  body: string;
  remoteAddress?: string;
  remotePort?: number;
}

async function startServer(
  respond: (req: http.IncomingMessage, res: http.ServerResponse) => void = (_req, res) => {
    res.statusCode = 200;
    res.end("ok");
  },
) {
  const seen: Seen[] = [];
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      seen.push({
        method: req.method,
        url: req.url,
        headers: req.headers,
        body: Buffer.concat(chunks).toString("utf8"),
        remoteAddress: req.socket.remoteAddress,
        remotePort: req.socket.remotePort,
      });
      respond(req, res);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  return { server, seen, port };
}

const servers: Array<http.Server | https.Server> = [];
async function observer(respond?: Parameters<typeof startServer>[0]) {
  const s = await startServer(respond);
  servers.push(s.server);
  return s;
}

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (s) =>
        new Promise<void>((resolve) => {
          s.closeAllConnections();
          s.close(() => resolve());
        }),
    ),
  );
});

describe("safeFetch: connects to the address the guard vetted", () => {
  it("delivers to the first (vetted) answer and never asks for a second one (DNS rebinding)", async () => {
    const { seen, port } = await observer();
    const { lookup, internals } = guardWith([[PUBLIC_FIRST], [PRIVATE_SECOND]]);

    const res = await safeFetch(
      `http://${NAME}:${port}/hook?x=1`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: '{"a":1}' },
      internals,
    );

    expect(res).toEqual({ ok: true, status: 200, statusText: "OK" });
    // One resolution in total: the one the guard vetted. A connect-time lookup
    // would have been the second call and would have answered PRIVATE_SECOND.
    expect(lookup).toHaveBeenCalledTimes(1);
    expect(seen).toHaveLength(1);
    expect(seen[0].remoteAddress).toBe(PUBLIC_FIRST);
    // Host header and request line stay on the original name and path.
    expect(seen[0].headers.host).toBe(`${NAME}:${port}`);
    expect(seen[0].method).toBe("POST");
    expect(seen[0].url).toBe("/hook?x=1");
    expect(seen[0].body).toBe('{"a":1}');
    expect(seen[0].headers["content-type"]).toBe("application/json");
    expect(seen[0].headers["content-length"]).toBe(String(Buffer.byteLength('{"a":1}')));
  });

  it("refuses a host whose first answer is private, even if a later answer would be public", async () => {
    const { seen, port } = await observer();
    const { lookup, internals } = guardWith([[PRIVATE_SECOND], [PUBLIC_FIRST]]);

    await expect(
      safeFetch(`http://${NAME}:${port}/`, { method: "POST", body: "{}" }, internals),
    ).rejects.toBeInstanceOf(ChannelConfigError);

    expect(lookup).toHaveBeenCalledTimes(1);
    expect(seen).toHaveLength(0);
  });

  it("refuses an answer set that mixes a public and a private address", async () => {
    const { seen, port } = await observer();
    const { internals } = guardWith([[PUBLIC_FIRST, PRIVATE_SECOND]]);

    await expect(
      safeFetch(`http://${NAME}:${port}/`, { method: "POST", body: "{}" }, internals),
    ).rejects.toThrow("blocked address range");
    expect(seen).toHaveLength(0);
  });

  it("connects to an IP literal directly without any lookup", async () => {
    const { seen, port } = await observer();
    const { lookup, internals } = guardWith([[PRIVATE_SECOND]]);

    const res = await safeFetch(`http://127.0.0.1:${port}/lit`, { method: "POST", body: "{}" }, internals);

    expect(res.ok).toBe(true);
    expect(lookup).not.toHaveBeenCalled();
    expect(seen).toHaveLength(1);
    expect(seen[0].headers.host).toBe(`127.0.0.1:${port}`);
  });

  it("applies the real range check when no seam is given (loopback literal refused, nothing sent)", async () => {
    const { seen, port } = await observer();

    await expect(
      safeFetch(`http://127.0.0.1:${port}/`, { method: "POST", body: "{}" }),
    ).rejects.toBeInstanceOf(ChannelConfigError);
    expect(seen).toHaveLength(0);
  });

  it("keeps the Host and framing headers it derives itself, ignoring caller overrides", async () => {
    const { seen, port } = await observer();
    const { internals } = guardWith([[PUBLIC_FIRST]]);

    await safeFetch(
      `http://${NAME}:${port}/`,
      {
        method: "POST",
        body: "abc",
        headers: { Host: "evil.example", "content-length": "1", "X-Custom": "kept" },
      },
      internals,
    );

    expect(seen[0].headers.host).toBe(`${NAME}:${port}`);
    expect(seen[0].headers["content-length"]).toBe("3");
    expect(seen[0].body).toBe("abc");
    expect(seen[0].headers["x-custom"]).toBe("kept");
  });
});

describe("safeFetch: redirects and timeouts", () => {
  it("does not follow a 3xx: the redirect target is never contacted and the answer is not ok", async () => {
    const target = await observer();
    const origin = await observer((_req, res) => {
      res.statusCode = 302;
      res.setHeader("Location", `http://127.0.0.1:${target.port}/internal`);
      res.end();
    });
    const { internals } = guardWith([[PUBLIC_FIRST]]);

    const res = await safeFetch(`http://${NAME}:${origin.port}/`, { method: "POST", body: "{}" }, internals);

    expect(res.ok).toBe(false);
    expect(res.status).toBe(302);
    expect(origin.seen).toHaveLength(1);
    expect(target.seen).toHaveLength(0);
  });

  it("reports a non-2xx status and its status text", async () => {
    const { port } = await observer((_req, res) => {
      res.statusCode = 404;
      res.statusMessage = "Not Found";
      res.end();
    });
    const { internals } = guardWith([[PUBLIC_FIRST]]);

    const res = await safeFetch(`http://${NAME}:${port}/`, { method: "POST", body: "{}" }, internals);

    expect(res).toEqual({ ok: false, status: 404, statusText: "Not Found" });
  });

  it("aborts a request whose answer does not arrive within the timeout", async () => {
    const { port } = await observer(() => {
      /* never answers */
    });
    const { internals } = guardWith([[PUBLIC_FIRST]]);

    await expect(
      safeFetch(`http://${NAME}:${port}/`, { method: "POST", body: "{}", timeoutMs: 50 }, internals),
    ).rejects.toThrow();
  });
});

describe("safeFetch: connection hygiene", () => {
  it("opens a fresh connection for every request (no pooled socket is shared)", async () => {
    const { server, seen, port } = await observer();
    const sockets = new Set<unknown>();
    server.on("connection", (socket) => sockets.add(socket));
    const { internals } = guardWith([[PUBLIC_FIRST]]);

    await safeFetch(`http://${NAME}:${port}/a`, { method: "POST", body: "{}" }, internals);
    await safeFetch(`http://${NAME}:${port}/b`, { method: "POST", body: "{}" }, internals);

    expect(seen).toHaveLength(2);
    expect(sockets.size).toBe(2);
    expect(seen[0].remotePort).not.toBe(seen[1].remotePort);
    // A private agent does not keep connections alive; the shared global agent
    // would announce keep-alive and offer the socket for reuse.
    expect(seen[0].headers.connection).toBe("close");
    expect(seen[1].headers.connection).toBe("close");
  });

  it("drops the response body so the socket closes soon after the status is known", async () => {
    let closed: Promise<void> = Promise.resolve();
    const { port } = await observer((_req, res) => {
      res.statusCode = 200;
      res.write("start");
      const timer = setInterval(() => res.write("x".repeat(1024)), 10);
      closed = new Promise<void>((resolve) =>
        res.on("close", () => {
          clearInterval(timer);
          resolve();
        }),
      );
    });
    const { internals } = guardWith([[PUBLIC_FIRST]]);

    const res = await safeFetch(
      `http://${NAME}:${port}/`,
      { method: "POST", body: "{}", timeoutMs: 20_000 },
      internals,
    );
    expect(res.ok).toBe(true);

    // The endless body must not keep the connection open: the server sees the
    // close well inside this bound (the request timeout is 20 s).
    let timer: NodeJS.Timeout | undefined;
    const outcome = await Promise.race([
      closed.then(() => "closed"),
      new Promise<string>((resolve) => {
        timer = setTimeout(() => resolve("still open"), 2_000);
      }),
    ]);
    clearTimeout(timer);
    expect(outcome).toBe("closed");
  });

  it("delivers a URL with userinfo without sending credentials", async () => {
    const { seen, port } = await observer();
    const { internals } = guardWith([[PUBLIC_FIRST]]);

    const res = await safeFetch(
      `http://user:pass@${NAME}:${port}/u`,
      { method: "POST", body: "{}" },
      internals,
    );

    expect(res.ok).toBe(true);
    expect(seen[0].url).toBe("/u");
    expect(seen[0].headers.authorization).toBeUndefined();
  });
});

describe("pinnedLookup", () => {
  const lookupOnce = (fn: ReturnType<typeof pinnedLookup>, options: Record<string, unknown>) =>
    new Promise<{ err: NodeJS.ErrnoException | null; address: unknown; family: unknown }>((resolve) => {
      fn("any.example", options as never, (err, address, family) => resolve({ err, address, family }));
    });

  it("answers only from the vetted set, in order", async () => {
    const fn = pinnedLookup(["192.0.2.1", "2001:db8::1"]);
    expect(await lookupOnce(fn, {})).toMatchObject({ err: null, address: "192.0.2.1", family: 4 });
    expect(await lookupOnce(fn, { all: true })).toMatchObject({
      err: null,
      address: [
        { address: "192.0.2.1", family: 4 },
        { address: "2001:db8::1", family: 6 },
      ],
    });
  });

  it("honours a requested family without leaving the vetted set", async () => {
    const fn = pinnedLookup(["192.0.2.1", "2001:db8::1"]);
    expect(await lookupOnce(fn, { family: 6 })).toMatchObject({
      err: null,
      address: "2001:db8::1",
      family: 6,
    });
    expect(await lookupOnce(fn, { family: 4, all: true })).toMatchObject({
      address: [{ address: "192.0.2.1", family: 4 }],
    });
  });

  it("fails with ENOTFOUND instead of inventing an address when no vetted one fits", async () => {
    const fn = pinnedLookup(["192.0.2.1"]);
    const out = await lookupOnce(fn, { family: 6 });
    expect(out.err?.code).toBe("ENOTFOUND");
  });
});

describe("safeFetch: TLS validates against the original host name", () => {
  let dir: string;

  function makeCert(name: string) {
    execFileSync(
      "openssl",
      [
        "req",
        "-x509",
        "-newkey",
        "ec",
        "-pkeyopt",
        "ec_paramgen_curve:prime256v1",
        "-nodes",
        "-keyout",
        join(dir, `${name}.key`),
        "-out",
        join(dir, `${name}.crt`),
        "-days",
        "2",
        "-subj",
        `/CN=${name}`,
        "-addext",
        `subjectAltName=DNS:${name}`,
      ],
      { stdio: "pipe" },
    );
    return { key: readFileSync(join(dir, `${name}.key`)), cert: readFileSync(join(dir, `${name}.crt`)) };
  }

  async function startTls(cred: { key: Buffer; cert: Buffer }) {
    const sni: Array<string | undefined> = [];
    const seen: string[] = [];
    const server = https.createServer(cred, (req, res) => {
      seen.push(req.headers.host ?? "");
      res.statusCode = 200;
      res.end("ok");
    });
    server.on("secureConnection", (socket) =>
      sni.push((socket as unknown as { servername?: string }).servername),
    );
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    servers.push(server);
    return { port: (server.address() as AddressInfo).port, sni, seen };
  }

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "safe-fetch-tls-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("accepts a certificate for the URL's host name while dialling the pinned address, and sends that name as SNI", async () => {
    const name = "tls.example.test";
    const cred = makeCert(name);
    const { port, sni, seen } = await startTls(cred);
    const { internals } = guardWith([[PUBLIC_FIRST]]);

    const res = await safeFetch(
      `https://${name}:${port}/hook`,
      { method: "POST", body: "{}" },
      { ...internals, ca: cred.cert },
    );

    expect(res.ok).toBe(true);
    expect(sni).toEqual([name]);
    expect(seen).toEqual([`${name}:${port}`]);
  });

  it("rejects a certificate issued for another name, even though the pinned address is the one serving it", async () => {
    const cred = makeCert("other.example.test");
    const { port, seen } = await startTls(cred);
    const { internals } = guardWith([[PUBLIC_FIRST]]);

    await expect(
      safeFetch(
        `https://tls.example.test:${port}/hook`,
        { method: "POST", body: "{}" },
        { ...internals, ca: cred.cert },
      ),
    ).rejects.toMatchObject({ code: "ERR_TLS_CERT_ALTNAME_INVALID" });
    expect(seen).toHaveLength(0);
  });

  it("rejects a self-signed certificate that is not in the trust store", async () => {
    const name = "tls.example.test";
    const cred = makeCert(name);
    const { port, seen } = await startTls(cred);
    const { internals } = guardWith([[PUBLIC_FIRST]]);

    await expect(
      safeFetch(`https://${name}:${port}/hook`, { method: "POST", body: "{}" }, internals),
    ).rejects.toMatchObject({ code: expect.stringMatching(/SELF_SIGNED|UNABLE_TO_VERIFY/) });
    expect(seen).toHaveLength(0);
  });
});
