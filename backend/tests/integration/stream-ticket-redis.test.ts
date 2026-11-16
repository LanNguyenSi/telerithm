import { createHash, randomUUID } from "node:crypto";
import IORedis from "ioredis";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  consumeStreamTicket,
  issueStreamTicket,
  type StreamTicketGrant,
} from "../../src/services/streaming/stream-ticket.js";

// The ticket store against a real Redis: the atomic single use rests on GETDEL,
// which a fake cannot show. CI runs a Redis service (REDIS_URL); without one
// the cases are skipped locally, and fail in CI so a missing service cannot
// pass silently.
const Redis = IORedis.default ?? IORedis;
const url = process.env.REDIS_URL ?? "redis://localhost:6379";
const client = new Redis(url, { lazyConnect: true, maxRetriesPerRequest: 0, retryStrategy: () => null });
client.on("error", () => {});

let reachable = false;
beforeAll(async () => {
  try {
    await client.connect();
    await client.ping();
    reachable = true;
  } catch {
    reachable = false;
  }
  if (!reachable && process.env.CI) {
    throw new Error(`Redis is not reachable at ${url}, but CI must run the ticket store tests against it`);
  }
});

afterAll(async () => {
  if (reachable) await client.quit();
  else client.disconnect();
});

const keyOf = (ticket: string) => `stream-ticket:${createHash("sha256").update(ticket).digest("hex")}`;
const grant = (): StreamTicketGrant => ({ sessionId: randomUUID(), userId: randomUUID(), teamId: randomUUID() });

describe("stream tickets against Redis", () => {
  it("consumes a ticket once", async (ctx) => {
    if (!reachable) return ctx.skip();
    const g = grant();
    const { ticket } = await issueStreamTicket(client, g);

    await expect(consumeStreamTicket(client, ticket)).resolves.toEqual(g);
    await expect(consumeStreamTicket(client, ticket)).resolves.toBeNull();
  });

  it("lets exactly one of 25 concurrent uses win", async (ctx) => {
    if (!reachable) return ctx.skip();
    const g = grant();
    const { ticket } = await issueStreamTicket(client, g);

    const results = await Promise.all(Array.from({ length: 25 }, () => consumeStreamTicket(client, ticket)));

    expect(results.filter((result) => result !== null)).toEqual([g]);
  });

  it("stores the entry under the hash of the ticket with a time to live of at most 60 seconds", async (ctx) => {
    if (!reachable) return ctx.skip();
    const { ticket } = await issueStreamTicket(client, grant());
    const key = keyOf(ticket);

    const ttl = await client.ttl(key);

    expect(await client.exists(ticket, `stream-ticket:${ticket}`)).toBe(0);
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(60);
    await consumeStreamTicket(client, ticket);
  });

  it("answers null once the entry has expired", async (ctx) => {
    if (!reachable) return ctx.skip();
    const { ticket } = await issueStreamTicket(client, grant());
    // Shorten this ticket's life to one second instead of waiting a minute.
    await client.expire(keyOf(ticket), 1);
    await new Promise((resolve) => setTimeout(resolve, 1500));

    await expect(consumeStreamTicket(client, ticket)).resolves.toBeNull();
  });
});
