import { createHash, randomBytes } from "node:crypto";

// One-time tickets for the log stream. EventSource cannot send an
// Authorization header, so a browser used to put the session token into the
// stream URL. A ticket replaces it: the caller (authenticated with the header)
// asks for a ticket, then opens the stream with `?ticket=`. A ticket
//   - is 32 random bytes, handed out once and stored only as a SHA-256 hash,
//   - lives STREAM_TICKET_TTL_SECONDS and is consumed by its first use (GETDEL
//     is one atomic Redis command, so two concurrent uses cannot both win),
//   - is bound to the session it was issued for, that session's user and one
//     team, so it opens a stream for that team only and the stream's
//     heartbeat can keep checking the session.
// The store is Redis: it is already a hard dependency of the backend and is
// shared by every backend instance, so a ticket issued by one instance can be
// consumed by another. Redis evicting a ticket early (maxmemory policy) or
// losing it fails closed: the stream answers 401 and the client asks for a new
// ticket.

export const STREAM_TICKET_TTL_SECONDS = 60;

const KEY_PREFIX = "stream-ticket:";

/** What a ticket stands for. */
export interface StreamTicketGrant {
  sessionId: string;
  userId: string;
  teamId: string;
}

/** The two Redis commands the ticket store needs (ioredis satisfies it). */
export interface TicketStore {
  set(key: string, value: string, mode: "EX", seconds: number): Promise<unknown>;
  getdel(key: string): Promise<string | null>;
}

function keyFor(ticket: string): string {
  return KEY_PREFIX + createHash("sha256").update(ticket).digest("hex");
}

export async function issueStreamTicket(
  store: TicketStore,
  grant: StreamTicketGrant,
): Promise<{ ticket: string; expiresInSeconds: number }> {
  const ticket = randomBytes(32).toString("base64url");
  const value = JSON.stringify({ sessionId: grant.sessionId, userId: grant.userId, teamId: grant.teamId });
  await store.set(keyFor(ticket), value, "EX", STREAM_TICKET_TTL_SECONDS);
  return { ticket, expiresInSeconds: STREAM_TICKET_TTL_SECONDS };
}

/**
 * The grant a ticket stands for, or null when the ticket is unknown, expired,
 * already used or malformed. The ticket is gone after this call whatever the
 * answer, so a second call with the same value always returns null.
 */
export async function consumeStreamTicket(
  store: TicketStore,
  ticket: string,
): Promise<StreamTicketGrant | null> {
  if (ticket.length === 0 || ticket.length > 256) {
    return null;
  }
  const raw = await store.getdel(keyFor(ticket));
  if (raw === null) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<StreamTicketGrant> | null;
    if (
      parsed &&
      typeof parsed.sessionId === "string" &&
      typeof parsed.userId === "string" &&
      typeof parsed.teamId === "string"
    ) {
      return { sessionId: parsed.sessionId, userId: parsed.userId, teamId: parsed.teamId };
    }
  } catch {
    /* fall through: a value this code did not write grants nothing */
  }
  return null;
}
