import { createHash, randomUUID } from "node:crypto";

export function generateId(): string {
  return randomUUID();
}

export function hashValue(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

