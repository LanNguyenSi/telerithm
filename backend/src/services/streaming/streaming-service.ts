import type { EventEmitter } from "node:events";
import type { Response } from "express";
import type { LogEntry } from "../../types/domain.js";
import { activeConnections } from "../../metrics/index.js";

type StreamFilters = {
  sourceId?: string;
  service?: string;
  host?: string;
  level?: string;
  query?: string;
};

// Called on every heartbeat. Resolving false ends the stream; a rejection is
// not a verdict and leaves it open until the next heartbeat.
type Revalidate = () => Promise<boolean>;

type StreamLimit = { userId: string; max?: number };

// Used when the caller passes no cap (the config default is the same value).
const DEFAULT_MAX_STREAMS_PER_USER = 5;

export class StreamingService {
  // Open streams per user id, in this process only. An entry exists only while
  // its count is above zero.
  private readonly streamsByUser = new Map<string, number>();

  constructor(private readonly events: EventEmitter) {}

  activeStreamsFor(userId: string): number {
    return this.streamsByUser.get(userId) ?? 0;
  }

  private takeSlot(userId: string, max: number): (() => void) | null {
    const open = this.activeStreamsFor(userId);
    if (open >= max) {
      return null;
    }
    this.streamsByUser.set(userId, open + 1);
    // Called once, from the stream's idempotent close.
    return () => {
      const left = this.activeStreamsFor(userId) - 1;
      if (left > 0) {
        this.streamsByUser.set(userId, left);
      } else {
        this.streamsByUser.delete(userId);
      }
    };
  }

  // With `limit`, returns null when the user already has `limit.max` streams
  // open (nothing is written to `res` then). Returns a no-op close when `res` is
  // already gone: the client left while the caller was still checking its
  // credentials, so no `close` event will fire for a listener registered from
  // here on. The stream ends itself, and gives its slot back, when `res` closes
  // or fails; the returned function ends it earlier and is safe to call twice.
  subscribe(teamId: string, res: Response, filters?: StreamFilters, revalidate?: Revalidate): () => void;
  subscribe(
    teamId: string,
    res: Response,
    filters: StreamFilters | undefined,
    revalidate: Revalidate | undefined,
    limit: StreamLimit,
  ): (() => void) | null;
  subscribe(
    teamId: string,
    res: Response,
    filters?: StreamFilters,
    revalidate?: Revalidate,
    limit?: StreamLimit,
  ): (() => void) | null {
    if (res.destroyed || res.closed || res.writableEnded) {
      return () => {};
    }

    let releaseSlot = () => {};
    if (limit) {
      const release = this.takeSlot(limit.userId, limit.max ?? DEFAULT_MAX_STREAMS_PER_USER);
      if (release === null) {
        return null;
      }
      releaseSlot = release;
    }

    try {
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      res.flushHeaders();
    } catch (error) {
      releaseSlot();
      throw error;
    }

    activeConnections.inc();

    const onLog = (log: LogEntry) => {
      if (log.teamId !== teamId) {
        return;
      }
      if (filters?.sourceId && log.sourceId !== filters.sourceId) {
        return;
      }
      if (filters?.service && log.service !== filters.service) {
        return;
      }
      if (filters?.host && log.host !== filters.host) {
        return;
      }
      if (filters?.level && log.level !== filters.level) {
        return;
      }
      if (filters?.query) {
        const lowered = filters.query.toLowerCase();
        const haystack = `${log.message} ${log.service} ${log.host}`.toLowerCase();
        if (!haystack.includes(lowered)) {
          return;
        }
      }

      res.write(`event: log:new\n`);
      res.write(`data: ${JSON.stringify(log)}\n\n`);
    };

    this.events.on("log:new", onLog);

    let closed = false;
    const close = () => {
      if (closed) {
        return;
      }
      closed = true;
      releaseSlot();
      activeConnections.dec();
      clearInterval(heartbeat);
      this.events.off("log:new", onLog);
      res.end();
    };

    const heartbeat = setInterval(() => {
      if (!revalidate) {
        res.write(`event: ping\n`);
        res.write(`data: {}\n\n`);
        return;
      }
      revalidate().then(
        (stillAllowed) => {
          if (closed) {
            return;
          }
          if (!stillAllowed) {
            close();
            return;
          }
          res.write(`event: ping\n`);
          res.write(`data: {}\n\n`);
        },
        () => {
          // Lookup failed: not a verdict. Keep the stream, try again next beat.
          if (!closed) {
            res.write(`event: ping\n`);
            res.write(`data: {}\n\n`);
          }
        },
      );
    }, 15000);

    // `close` fires on every end of the connection, `error` on a socket that
    // failed while the response was open.
    res.once("close", close);
    res.once("error", close);

    return close;
  }
}
