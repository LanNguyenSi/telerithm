import { EventEmitter } from "node:events";
import type { IngestRequestPayload, IngestResponse, LogEntry } from "../types/domain.js";
import { LogRepository } from "../repositories/log-repository.js";
import { TeamService } from "../services/team/team-service.js";
import { LogParser } from "../parser/log-parser.js";
import { IssueService } from "../services/issue/issue-service.js";
import { generateId, generateLogId } from "../utils/id.js";
import { createChildLogger } from "../logger.js";
import { cache } from "../cache/cache-service.js";
import { ingestBatchTotal, ingestLogsTotal } from "../metrics/index.js";
import { MAX_INGEST_BATCH } from "../validation/schemas.js";

const log = createChildLogger("ingestion");

// The schema cap on ingestSchema.logs bounds array elements; this error
// reports a request whose parsed entry count exceeds MAX_INGEST_BATCH (a raw
// string element can expand into many entries), so the router can answer 413.
export class IngestBatchTooLargeError extends Error {
  constructor(readonly maxEntries: number) {
    super(`Too many log entries: an ingest request is capped at ${maxEntries} parsed entries`);
    this.name = "IngestBatchTooLargeError";
  }
}

export class IngestionService {
  readonly events = new EventEmitter();
  private readonly parser = new LogParser();
  private readonly logRepo = new LogRepository();
  private readonly teamService = new TeamService();
  private readonly issueService = new IssueService();

  async ingest(sourceId: string, payload: IngestRequestPayload): Promise<IngestResponse> {
    const source = await this.teamService.findSourceById(sourceId);
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
          id: generateLogId(),
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

    // The schema bounds the array elements; bound the parsed entries here.
    // A string element can expand into any number of entries (a leading "["
    // is parsed as a JSON array), so a request inside the schema cap can
    // still hold more than MAX_INGEST_BATCH entries. Reject the whole batch
    // before anything is written or tracked.
    if (accepted.length > MAX_INGEST_BATCH) {
      throw new IngestBatchTooLargeError(MAX_INGEST_BATCH);
    }

    if (accepted.length > 0) {
      await this.logRepo.insert(accepted);
      await cache.invalidate(`dashboard:overview:${source.teamId}`);
      for (const entry of accepted) {
        this.events.emit("log:new", entry);
      }
      // Fire-and-forget: track errors/fatals as issues in one detached
      // sequential chain per batch, so a large batch can never hold more
      // than one issue upsert open at a time.
      const errorEntries = accepted.filter((entry) => entry.level === "error" || entry.level === "fatal");
      if (errorEntries.length > 0) {
        void this.trackErrorIssues(errorEntries);
      }
    }

    log.info({ batchId, accepted: accepted.length, rejected: errors.length }, "Batch ingested");

    ingestBatchTotal.inc({ status: errors.length > 0 ? "partial" : "ok" });
    ingestLogsTotal.inc(accepted.length);

    return {
      accepted: accepted.length,
      rejected: errors.length,
      errors,
      batchId,
    };
  }

  // Awaits each trackError in turn and swallows failures like the previous
  // per-entry .catch(() => {}); one failure never stops the following calls.
  private async trackErrorIssues(entries: LogEntry[]): Promise<void> {
    for (const entry of entries) {
      try {
        await this.issueService.trackError(entry.teamId, entry.level, entry.service, entry.message);
      } catch {
        // issue tracking is best-effort; keep walking the chain
      }
    }
  }
}
