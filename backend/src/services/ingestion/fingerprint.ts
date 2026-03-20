import { createHash } from "node:crypto";

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const HEX_RE = /\b0x[0-9a-f]+\b/gi;
const NUMBER_RE = /\b\d+\b/g;
const IP_RE = /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g;
const TIMESTAMP_RE = /\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}[.\dZ+:-]*/g;
const FILE_LINE_RE = /[/\\][\w./-]+:\d+/g;

export function normalizeMessage(message: string): string {
  return message
    .replace(UUID_RE, "<UUID>")
    .replace(TIMESTAMP_RE, "<TS>")
    .replace(IP_RE, "<IP>")
    .replace(HEX_RE, "<HEX>")
    .replace(FILE_LINE_RE, "<PATH>")
    .replace(NUMBER_RE, "<N>")
    .trim();
}

export function computeFingerprint(level: string, service: string, message: string): string {
  const normalized = normalizeMessage(message);
  const input = `${level}|${service}|${normalized}`;
  return createHash("sha256").update(input).digest("hex").slice(0, 16);
}
