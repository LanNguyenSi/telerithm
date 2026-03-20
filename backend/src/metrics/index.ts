import { Registry, Counter, Histogram, Gauge, collectDefaultMetrics } from "prom-client";

export const registry = new Registry();

collectDefaultMetrics({ register: registry });

export const httpRequestsTotal = new Counter({
  name: "logforge_http_requests_total",
  help: "Total number of HTTP requests",
  labelNames: ["method", "route", "status"] as const,
  registers: [registry],
});

export const httpRequestDuration = new Histogram({
  name: "logforge_http_request_duration_ms",
  help: "HTTP request duration in milliseconds",
  labelNames: ["method", "route", "status"] as const,
  buckets: [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000],
  registers: [registry],
});

export const ingestBatchTotal = new Counter({
  name: "logforge_ingest_batches_total",
  help: "Total number of ingest batches processed",
  labelNames: ["status"] as const,
  registers: [registry],
});

export const ingestLogsTotal = new Counter({
  name: "logforge_ingest_logs_total",
  help: "Total number of individual log entries ingested",
  registers: [registry],
});

export const activeConnections = new Gauge({
  name: "logforge_active_sse_connections",
  help: "Number of active SSE streaming connections",
  registers: [registry],
});

export const alertEvaluationsTotal = new Counter({
  name: "logforge_alert_evaluations_total",
  help: "Total number of alert rule evaluations",
  labelNames: ["status"] as const,
  registers: [registry],
});

export const alertIncidentsCreatedTotal = new Counter({
  name: "logforge_alert_incidents_created_total",
  help: "Total number of alert incidents created by evaluation worker",
  registers: [registry],
});
