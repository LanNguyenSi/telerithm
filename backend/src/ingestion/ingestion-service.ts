import { EventEmitter } from "node:events";
import type { IngestRequestPayload, IngestResponse, LogEntry } from "../types/domain.js";
import { LogRepository } from "../repositories/log-repository.js";
import { TeamService } from "../services/team/team-service.js";
import { LogParser } from "../parser/log-parser.js";
import { IssueService } from "../services/issue/issue-service.js";
import { generateId } from "../utils/id.js";
import { createChildLogger } from "../logger.js";
import { cache } from "../cache/cache-service.js";
import { ingestBatchTotal, ingestLogsTotal } from "../metrics/index.js";

const log = createChildLogger("ingestion");

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
      await this.logRepo.insert(accepted);
      await cache.invalidate(`dashboard:overview:${source.teamId}`);
      for (const entry of accepted) {
        this.events.emit("log:new", entry);
        // Fire-and-forget: track errors/fatals as issues
        if (entry.level === "error" || entry.level === "fatal") {
          this.issueService
            .trackError(entry.teamId, entry.level, entry.service, entry.message)
            .catch(() => {});
        }
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
}
