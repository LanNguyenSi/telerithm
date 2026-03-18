import type { IngestRequestPayload, IngestResponse, LogEntry } from "../types/domain.js";
import { store } from "../repositories/in-memory-store.js";
import { LogParser } from "../parser/log-parser.js";
import { generateId } from "../utils/id.js";

export class IngestionService {
  private readonly parser = new LogParser();

  ingest(sourceId: string, payload: IngestRequestPayload): IngestResponse {
    const source = store.sources.find((item) => item.id === sourceId);
    if (!source) {
      throw new Error("Source not found");
    }

    const batchId = payload.batchId ?? generateId();
    const accepted: LogEntry[] = [];
    const errors: Array<{ index: number; error: string }> = [];

    payload.logs.forEach((item, index) => {
      try {
        if (typeof item === "string") {
          const format = payload.format ?? this.parser.detectFormat(item);
          accepted.push(...this.parser.parseRaw(item, format, source.teamId, sourceId));
          return;
        }

        accepted.push({
          id: generateId(),
          teamId: source.teamId,
          sourceId,
          timestamp: item.timestamp ?? new Date().toISOString(),
          level: item.level ?? "info",
          service: item.service ?? source.name,
          host: item.host ?? "unknown",
          message: item.message ?? "",
          fields: item.fields ?? {},
        });
      } catch (error) {
        errors.push({
          index,
          error: error instanceof Error ? error.message : "Invalid log entry",
        });
      }
    });

    if (accepted.length > 0) {
      store.logs.push(...accepted);
      for (const log of accepted) {
        store.events.emit("log:new", log);
      }
    }

    return {
      accepted: accepted.length,
      rejected: errors.length,
      errors,
      batchId,
    };
  }
}

