import type { EventEmitter } from "node:events";
import type { Response } from "express";
import type { LogEntry } from "../../types/domain.js";
import { activeConnections } from "../../metrics/index.js";

export class StreamingService {
  constructor(private readonly events: EventEmitter) {}

  subscribe(teamId: string, res: Response): () => void {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    activeConnections.inc();

    const onLog = (log: LogEntry) => {
      if (log.teamId === teamId) {
        res.write(`event: log:new\n`);
        res.write(`data: ${JSON.stringify(log)}\n\n`);
      }
    };

    this.events.on("log:new", onLog);

    const heartbeat = setInterval(() => {
      res.write(`event: ping\n`);
      res.write(`data: {}\n\n`);
    }, 15000);

    return () => {
      activeConnections.dec();
      clearInterval(heartbeat);
      this.events.off("log:new", onLog);
      res.end();
    };
  }
}
