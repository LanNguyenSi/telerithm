import type { LogEntry, LogFormat, LogLevel } from "../types/domain.js";
import { generateLogId } from "../utils/id.js";

const RFC3164_PATTERN = /^<\d+>([A-Z][a-z]{2}\s+\d+\s[\d:]+)\s(\S+)\s([^:]+):\s?(.*)$/;
const RFC5424_PATTERN = /^<\d+>1\s([^\s]+)\s([^\s]+)\s([^\s]+)\s([^\s]+)\s([^\s]+)\s-?\s?(.*)$/;

function normalizeLevel(input?: string): LogLevel {
  const value = (input ?? "info").toLowerCase();
  if (["debug", "info", "warn", "error", "fatal"].includes(value)) {
    return value as LogLevel;
  }
  if (value.includes("err")) {
    return "error";
  }
  if (value.includes("warning")) {
    return "warn";
  }
  return "info";
}

export class LogParser {
  detectFormat(sample: string): LogFormat {
    const trimmed = sample.trim();
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      return "json";
    }
    if (RFC5424_PATTERN.test(trimmed)) {
      return "syslog_rfc5424";
    }
    if (RFC3164_PATTERN.test(trimmed)) {
      return "syslog_rfc3164";
    }
    return "plain";
  }

  parseRaw(raw: string, format: LogFormat, teamId: string, sourceId: string): LogEntry[] {
    if (format === "json") {
      return this.parseJson(raw, teamId, sourceId);
    }
    if (format === "syslog_rfc3164") {
      return [this.parseRfc3164(raw, teamId, sourceId)];
    }
    if (format === "syslog_rfc5424") {
      return [this.parseRfc5424(raw, teamId, sourceId)];
    }
    return [this.parsePlain(raw, teamId, sourceId)];
  }

  private parseJson(raw: string, teamId: string, sourceId: string): LogEntry[] {
    const parsed = JSON.parse(raw);
    const items = Array.isArray(parsed) ? parsed : [parsed];
    return items.map((entry) => {
      const record = entry as Record<string, unknown>;
      return {
        id: generateLogId(),
        teamId,
        sourceId,
        timestamp: new Date(
          typeof record.timestamp === "string" ? record.timestamp : Date.now(),
        ).toISOString(),
        level: normalizeLevel(typeof record.level === "string" ? record.level : undefined),
        service: typeof record.service === "string" ? record.service : "unknown",
        host: typeof record.host === "string" ? record.host : "unknown",
        message: typeof record.message === "string" ? record.message : JSON.stringify(record),
        fields:
          typeof record.fields === "object" && record.fields !== null
            ? (record.fields as Record<string, string | number | boolean>)
            : {},
      };
    });
  }

  private parseRfc3164(raw: string, teamId: string, sourceId: string): LogEntry {
    const match = raw.match(RFC3164_PATTERN);
    if (!match) {
      return this.parsePlain(raw, teamId, sourceId);
    }
    const [, timestamp, host, service, message] = match;
    return {
      id: generateLogId(),
      teamId,
      sourceId,
      timestamp: new Date(`${new Date().getFullYear()} ${timestamp} UTC`).toISOString(),
      level: normalizeLevel(message),
      service,
      host,
      message,
      fields: {},
    };
  }

  private parseRfc5424(raw: string, teamId: string, sourceId: string): LogEntry {
    const match = raw.match(RFC5424_PATTERN);
    if (!match) {
      return this.parsePlain(raw, teamId, sourceId);
    }
    const [, timestamp, host, appName, , , message] = match;
    return {
      id: generateLogId(),
      teamId,
      sourceId,
      timestamp: new Date(timestamp).toISOString(),
      level: normalizeLevel(message),
      service: appName,
      host,
      message,
      fields: {},
    };
  }

  private parsePlain(raw: string, teamId: string, sourceId: string): LogEntry {
    return {
      id: generateLogId(),
      teamId,
      sourceId,
      timestamp: new Date().toISOString(),
      level: normalizeLevel(raw),
      service: "unknown",
      host: "unknown",
      message: raw,
      fields: {},
    };
  }
}
