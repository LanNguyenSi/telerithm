import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  STREAM_TICKET_TTL_SECONDS,
  consumeStreamTicket,
  issueStreamTicket,
  type StreamTicketGrant,
  type TicketStore,
} from "../../src/services/streaming/stream-ticket.js";

// A store with Redis's observable behaviour for the two commands the ticket
// code uses: SET ... EX and GETDEL (read and delete as one step, so an entry
// is handed to exactly one caller). The clock is injectable to let an entry
// expire.
function fakeStore(clock: { now: number } = { now: 1_000_000 }) {
  const entries = new Map<string, { value: string; expiresAt: number }>();
  const calls: string[] = [];
  const store: TicketStore = {
    async set(key, value, _mode, seconds) {
      calls.push(`set ${key} EX ${seconds}`);
      entries.set(key, { value, expiresAt: clock.now + seconds * 1000 });
      return "OK";
    },
    async getdel(key) {
      calls.push(`getdel ${key}`);
      const entry = entries.get(key);
      entries.delete(key);
      // Yield after the removal: a second caller that started meanwhile has
      // already seen the key gone.
      await Promise.resolve();
      if (!entry || entry.expiresAt <= clock.now) return null;
      return entry.value;
    },
  };
  return { store, entries, calls, clock };
}

const grant: StreamTicketGrant = { sessionId: "sess-row-1", userId: "u1", teamId: "t1" };
const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

describe("issueStreamTicket", () => {
  it("returns a ticket of 32 random bytes (43 base64url characters) and the lifetime", async () => {
    const { store } = fakeStore();

    const issued = await issueStreamTicket(store, grant);

    expect(issued.ticket).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(issued.expiresInSeconds).toBe(60);
    expect(STREAM_TICKET_TTL_SECONDS).toBe(60);
  });

  it("hands out a different ticket every time", async () => {
    const { store } = fakeStore();

    const tickets = await Promise.all(Array.from({ length: 20 }, () => issueStreamTicket(store, grant)));

    expect(new Set(tickets.map((issued) => issued.ticket)).size).toBe(20);
  });

  it("stores the grant under the hash of the ticket with a 60 second expiry, never the ticket itself", async () => {
    const { store, entries, calls } = fakeStore();

    const { ticket } = await issueStreamTicket(store, grant);

    const key = `stream-ticket:${sha256(ticket)}`;
    expect(calls).toEqual([`set ${key} EX 60`]);
    expect([...entries.keys()]).toEqual([key]);
    expect(JSON.parse(entries.get(key)!.value)).toEqual(grant);
    expect(key).not.toContain(ticket);
    expect(entries.get(key)!.value).not.toContain(ticket);
  });
});

describe("consumeStreamTicket", () => {
  it("returns the grant of a fresh ticket", async () => {
    const { store } = fakeStore();
    const { ticket } = await issueStreamTicket(store, grant);

    await expect(consumeStreamTicket(store, ticket)).resolves.toEqual(grant);
  });

  it("returns null the second time: a ticket is used once", async () => {
    const { store, entries } = fakeStore();
    const { ticket } = await issueStreamTicket(store, grant);

    await consumeStreamTicket(store, ticket);

    await expect(consumeStreamTicket(store, ticket)).resolves.toBeNull();
    expect(entries.size).toBe(0);
  });

  it("returns null for an expired ticket", async () => {
    const { store, clock } = fakeStore();
    const { ticket } = await issueStreamTicket(store, grant);
    clock.now += 60_000;

    await expect(consumeStreamTicket(store, ticket)).resolves.toBeNull();
  });

  it("still accepts a ticket one millisecond before it expires", async () => {
    const { store, clock } = fakeStore();
    const { ticket } = await issueStreamTicket(store, grant);
    clock.now += 59_999;

    await expect(consumeStreamTicket(store, ticket)).resolves.toEqual(grant);
  });

  it("returns null for an unknown ticket", async () => {
    const { store } = fakeStore();
    await issueStreamTicket(store, grant);

    await expect(consumeStreamTicket(store, "A".repeat(43))).resolves.toBeNull();
  });

  it("returns null for an empty or oversized ticket without asking the store", async () => {
    const { store, calls } = fakeStore();

    await expect(consumeStreamTicket(store, "")).resolves.toBeNull();
    await expect(consumeStreamTicket(store, "x".repeat(257))).resolves.toBeNull();
    expect(calls).toEqual([]);
  });

  it("keeps the grant of each ticket apart: another team's ticket grants that team only", async () => {
    const { store } = fakeStore();
    const mine = await issueStreamTicket(store, grant);
    const theirs = await issueStreamTicket(store, { ...grant, teamId: "t2", userId: "u2" });

    await expect(consumeStreamTicket(store, theirs.ticket)).resolves.toEqual({
      ...grant,
      teamId: "t2",
      userId: "u2",
    });
    await expect(consumeStreamTicket(store, mine.ticket)).resolves.toEqual(grant);
  });

  it("returns null and still removes an entry whose value is not a grant", async () => {
    for (const raw of ["not json", "null", "{}", JSON.stringify({ sessionId: "s", userId: "u" }), '"text"']) {
      const { store, entries } = fakeStore();
      entries.set(`stream-ticket:${sha256("forged")}`, { value: raw, expiresAt: Number.MAX_SAFE_INTEGER });

      await expect(consumeStreamTicket(store, "forged")).resolves.toBeNull();
      expect(entries.size).toBe(0);
    }
  });

  it("lets exactly one of many concurrent uses win", async () => {
    const { store, calls } = fakeStore();
    const { ticket } = await issueStreamTicket(store, grant);

    const results = await Promise.all(Array.from({ length: 10 }, () => consumeStreamTicket(store, ticket)));

    expect(results.filter((result) => result !== null)).toEqual([grant]);
    // One atomic read-and-delete per use: no separate read that a second
    // caller could slip between.
    expect(calls.filter((call) => call.startsWith("getdel"))).toHaveLength(10);
    expect(calls.filter((call) => /^(get|del) /.test(call))).toEqual([]);
  });

  it("does not swallow a store failure", async () => {
    const store: TicketStore = {
      set: vi.fn(),
      getdel: vi.fn().mockRejectedValue(new Error("redis down")),
    };

    await expect(consumeStreamTicket(store, "A".repeat(43))).rejects.toThrow("redis down");
  });
});
