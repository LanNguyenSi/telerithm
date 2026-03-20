import { sendBatch, type TransportConfig, type LogPayload } from "./transports/fetch.js";
import { setupGlobalErrorHandlers } from "./integrations/global-error.js";
import { BreadcrumbTracker, type Breadcrumb } from "./integrations/breadcrumbs.js";

export type LogLevel = "debug" | "info" | "warn" | "error" | "fatal";

export interface LogForgeOptions {
  /** DSN format: https://<apiKey>@<host>/<sourceId> or just the ingest URL */
  dsn?: string;
  /** Direct config (alternative to DSN) */
  endpoint?: string;
  apiKey?: string;
  sourceId?: string;
  /** Service name for this app */
  service?: string;
  /** Current release/version */
  release?: string;
  /** Environment (production, staging, etc.) */
  environment?: string;
  /** Enable automatic error capturing */
  autoCapture?: boolean;
  /** Enable breadcrumb tracking */
  breadcrumbs?: boolean;
  /** Max breadcrumbs to keep */
  maxBreadcrumbs?: number;
  /** Batch size before flush */
  batchSize?: number;
  /** Flush interval in ms */
  flushIntervalMs?: number;
  /** Request timeout in ms */
  timeout?: number;
}

interface QueuedLog {
  timestamp: string;
  level: string;
  service?: string;
  host?: string;
  message: string;
  fields?: Record<string, string | number | boolean>;
}

function parseDsn(dsn: string): { endpoint: string; apiKey: string } {
  const url = new URL(dsn);
  const apiKey = url.username;
  const sourceId = url.pathname.replace(/^\//, "");
  const base = `${url.protocol}//${url.host}`;
  return {
    endpoint: `${base}/api/v1/ingest/${sourceId}`,
    apiKey,
  };
}

export class LogForgeClient {
  private transport: TransportConfig;
  private queue: QueuedLog[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private teardownErrorHandlers: (() => void) | null = null;
  private readonly breadcrumbTracker: BreadcrumbTracker | null;
  private readonly service: string;
  private readonly release?: string;
  private readonly environment?: string;
  private readonly batchSize: number;
  private tags: Record<string, string> = {};
  private user: Record<string, string> = {};

  constructor(options: LogForgeOptions) {
    if (options.dsn) {
      const parsed = parseDsn(options.dsn);
      this.transport = { ...parsed, timeout: options.timeout };
    } else if (options.endpoint && options.apiKey) {
      const sourceId = options.sourceId ?? "";
      this.transport = {
        endpoint: `${options.endpoint}/api/v1/ingest/${sourceId}`,
        apiKey: options.apiKey,
        timeout: options.timeout,
      };
    } else {
      throw new Error("LogForge: provide either `dsn` or `endpoint` + `apiKey`");
    }

    this.service = options.service ?? "unknown";
    this.release = options.release;
    this.environment = options.environment;
    this.batchSize = options.batchSize ?? 10;

    // Breadcrumbs
    if (options.breadcrumbs !== false) {
      this.breadcrumbTracker = new BreadcrumbTracker(options.maxBreadcrumbs);
      this.breadcrumbTracker.instrumentConsole();
    } else {
      this.breadcrumbTracker = null;
    }

    // Auto-capture global errors
    if (options.autoCapture !== false) {
      this.teardownErrorHandlers = setupGlobalErrorHandlers(this);
    }

    // Flush timer
    const interval = options.flushIntervalMs ?? 5_000;
    this.timer = setInterval(() => this.flush(), interval);
  }

  setUser(userData: Record<string, string>): void {
    this.user = userData;
  }

  setTag(key: string, value: string): void {
    this.tags[key] = value;
  }

  addBreadcrumb(crumb: Omit<Breadcrumb, "timestamp">): void {
    this.breadcrumbTracker?.add(crumb);
  }

  log(level: LogLevel, message: string, extra?: Record<string, string | number | boolean>): void {
    const fields: Record<string, string | number | boolean> = {
      ...extra,
      ...this.tags,
    };

    if (this.release) fields._release = this.release;
    if (this.environment) fields._environment = this.environment;
    if (this.user.id) fields._userId = this.user.id;
    if (this.user.email) fields._userEmail = this.user.email;

    this.queue.push({
      timestamp: new Date().toISOString(),
      level,
      service: this.service,
      host: typeof window !== "undefined" ? window.location?.hostname : "node",
      message,
      fields,
    });

    if (this.queue.length >= this.batchSize) {
      this.flush();
    }
  }

  debug(message: string, extra?: Record<string, string | number | boolean>): void {
    this.log("debug", message, extra);
  }

  info(message: string, extra?: Record<string, string | number | boolean>): void {
    this.log("info", message, extra);
  }

  warn(message: string, extra?: Record<string, string | number | boolean>): void {
    this.log("warn", message, extra);
  }

  error(message: string, extra?: Record<string, string | number | boolean>): void {
    this.log("error", message, extra);
  }

  captureError(err: Error, extra?: Record<string, string | number | boolean>): void {
    const fields: Record<string, string | number | boolean> = {
      ...extra,
      _errorName: err.name,
    };
    if (err.stack) fields._stack = err.stack;

    // Attach breadcrumbs as JSON string
    if (this.breadcrumbTracker) {
      const crumbs = this.breadcrumbTracker.getAll();
      if (crumbs.length > 0) {
        fields._breadcrumbs = JSON.stringify(crumbs);
      }
    }

    this.log("error", err.message, fields);
  }

  async flush(): Promise<void> {
    if (this.queue.length === 0) return;

    const batch = this.queue.splice(0);
    const payload: LogPayload = { logs: batch };
    await sendBatch(this.transport, payload);
  }

  async close(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.teardownErrorHandlers?.();
    this.breadcrumbTracker?.teardown();
    await this.flush();
  }
}
