export { LogForgeClient, type LogForgeOptions, type LogLevel } from "./client.js";
export type { Breadcrumb } from "./integrations/breadcrumbs.js";

import { LogForgeClient, type LogForgeOptions } from "./client.js";

let defaultClient: LogForgeClient | null = null;

/** Initialize the global LogForge client */
export function init(options: LogForgeOptions): LogForgeClient {
  if (defaultClient) {
    defaultClient.close();
  }
  defaultClient = new LogForgeClient(options);
  return defaultClient;
}

/** Get the current global client */
export function getClient(): LogForgeClient | null {
  return defaultClient;
}

// Convenience re-exports that use the global client
export function captureError(err: Error, extra?: Record<string, string | number | boolean>): void {
  defaultClient?.captureError(err, extra);
}

export function log(
  level: "debug" | "info" | "warn" | "error" | "fatal",
  message: string,
  extra?: Record<string, string | number | boolean>,
): void {
  defaultClient?.log(level, message, extra);
}

export function setUser(user: Record<string, string>): void {
  defaultClient?.setUser(user);
}

export function setTag(key: string, value: string): void {
  defaultClient?.setTag(key, value);
}

export async function flush(): Promise<void> {
  await defaultClient?.flush();
}

export async function close(): Promise<void> {
  await defaultClient?.close();
  defaultClient = null;
}
