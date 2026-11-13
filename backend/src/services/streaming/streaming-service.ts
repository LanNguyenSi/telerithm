import type { EventEmitter } from "node:events";
import type { Response } from "express";
import type { LogEntry } from "../../types/domain.js";
import { activeConnections } from "../../metrics/index.js";

export class StreamingService {
  constructor(private readonly events: EventEmitter) {}

  subscribe(
    teamId: string,
    res: Response,
    filters?: {
      sourceId?: string;
      service?: string;
      host?: string;
      level?: string;
      query?: string;
    },
    // Called on every heartbeat. Resolving false ends the stream; a rejection is
    // not a verdict and leaves it open until the next heartbeat.
    revalidate?: () => Promise<boolean>,
  ): () => void {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

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

    return close;
  }
}
