import type { Response } from "express";
import { store } from "../../repositories/in-memory-store.js";
import type { LogEntry } from "../../types/domain.js";

export class StreamingService {
  subscribe(teamId: string, res: Response): () => void {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    const onLog = (log: LogEntry) => {
      if (log.teamId === teamId) {
        res.write(`event: log:new\n`);
        res.write(`data: ${JSON.stringify(log)}\n\n`);
      }
    };

    store.events.on("log:new", onLog);

    const heartbeat = setInterval(() => {
      res.write(`event: ping\n`);
      res.write(`data: {}\n\n`);
    }, 15000);

    return () => {
      clearInterval(heartbeat);
      store.events.off("log:new", onLog);
      res.end();
    };
  }
}

