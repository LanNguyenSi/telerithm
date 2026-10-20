import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChannelConfigError } from "../../src/services/notification/channels/errors.js";

// Real senders, real safeFetch, real url-guard logic. Only the two outside-world
// seams of the guard are replaced: the DNS answer (a rebinding host: public
// first, private afterwards) and the private-range predicate (the observer
// server lives on loopback, so only 10/8 counts as private here).
const { dnsAnswers, lookupCalls, mockFindForIncident } = vi.hoisted(() => ({
  dnsAnswers: new Map<string, string[][]>(),
  lookupCalls: new Map<string, number>(),
  mockFindForIncident: vi.fn(),
}));

vi.mock("../../src/services/notification/url-guard.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/services/notification/url-guard.js")>();
  const deps = {
    lookup: async (host: string) => {
      const n = lookupCalls.get(host) ?? 0;
      lookupCalls.set(host, n + 1);
      const answers = dnsAnswers.get(host) ?? [];
      return (answers[Math.min(n, answers.length - 1)] ?? []).map((address) => ({ address }));
    },
    isBlockedAddress: (ip: string) => ip.startsWith("10."),
  };
  return { ...actual, resolveSafeTarget: (raw: string) => actual.resolveSafeTarget(raw, deps) };
});

vi.mock("../../src/services/subscription/subscription-service.js", () => ({
  SubscriptionService: class {
    findForIncident = mockFindForIncident;
  },
}));

vi.mock("../../src/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), fatal: vi.fn() },
  createChildLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

import { NotificationDispatcher } from "../../src/services/notification/notification-dispatcher.js";

const PUBLIC_FIRST = "127.0.0.1";
const PRIVATE_SECOND = "10.0.0.99";

const INCIDENT = {
  id: "inc-1",
  ruleId: "rule-1",
  teamId: "team-1",
  severity: "HIGH",
  status: "OPEN",
  message: "Error rate exceeded threshold",
  createdAt: "2024-01-15T10:00:00.000Z",
};
const USER = { id: "u1", email: "u1@example.com", name: "U1" };

const hosts = {
  WEBHOOK: "rebind-webhook.example.invalid",
  SLACK: "rebind-slack.example.invalid",
  MSTEAMS: "rebind-teams.example.invalid",
} as const;
type Channel = keyof typeof hosts;
const CHANNELS = Object.keys(hosts) as Channel[];

let server: http.Server;
let port: number;
let seen: Array<{ url?: string; host?: string; remoteAddress?: string; body: string }>;

function subscription(channel: Channel) {
  const url = `http://${hosts[channel]}:${port}/${channel.toLowerCase()}`;
  return {
    id: `sub-${channel}`,
    channel,
    config: channel === "WEBHOOK" ? { url } : { webhook_url: url },
    user: USER,
  };
}

beforeEach(async () => {
  dnsAnswers.clear();
  lookupCalls.clear();
  mockFindForIncident.mockReset();
  seen = [];
  server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      seen.push({
        url: req.url,
        host: req.headers.host,
        remoteAddress: req.socket.remoteAddress,
        body: Buffer.concat(chunks).toString("utf8"),
      });
      res.statusCode = 200;
      res.end("ok");
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = (server.address() as AddressInfo).port;
});

afterEach(async () => {
  vi.useRealTimers();
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("notification delivery connects to the address the guard vetted (DNS rebinding)", () => {
  describe.each(CHANNELS)("%s", (channel) => {
    const host = hosts[channel];

    it("incident dispatch: delivers to the first answer; the rebound private answer is never requested", async () => {
      dnsAnswers.set(host, [[PUBLIC_FIRST], [PRIVATE_SECOND]]);
      mockFindForIncident.mockResolvedValue([subscription(channel)]);

      await new NotificationDispatcher().dispatch(INCIDENT);

      expect(lookupCalls.get(host)).toBe(1);
      expect(seen).toHaveLength(1);
      expect(seen[0].remoteAddress).toBe(PUBLIC_FIRST);
      expect(seen[0].host).toBe(`${host}:${port}`);
      expect(seen[0].url).toBe(`/${channel.toLowerCase()}`);
      expect(seen[0].body).toContain(INCIDENT.message);
    });

    it("subscription test path (dispatchToSubscription): delivers to the first answer, never the second", async () => {
      dnsAnswers.set(host, [[PUBLIC_FIRST], [PRIVATE_SECOND]]);

      await new NotificationDispatcher().dispatchToSubscription(subscription(channel), INCIDENT);

      expect(lookupCalls.get(host)).toBe(1);
      expect(seen).toHaveLength(1);
      expect(seen[0].remoteAddress).toBe(PUBLIC_FIRST);
      expect(seen[0].host).toBe(`${host}:${port}`);
    });

    it("subscription test path: a host that answers private is refused on every attempt and nothing is sent", async () => {
      vi.useFakeTimers();
      dnsAnswers.set(host, [[PRIVATE_SECOND]]);

      const sent = new NotificationDispatcher().dispatchToSubscription(subscription(channel), INCIDENT);
      const caught = sent.catch((e: unknown) => e);
      await vi.runAllTimersAsync();
      const err = await caught;

      expect(err).toBeInstanceOf(ChannelConfigError);
      // Each of the three attempts is vetted afresh and refused.
      expect(lookupCalls.get(host)).toBe(3);
      expect(seen).toHaveLength(0);
    });
  });
});
