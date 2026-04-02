import { createHash, randomUUID } from "node:crypto";
import { ulid } from "ulid";

export function generateId(): string {
  return randomUUID();
}

export function generateLogId(): string {
  return ulid();
}

export function hashValue(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
