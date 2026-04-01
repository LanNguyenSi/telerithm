import { clickhouse } from "./clickhouse.js";
import type { LogEntry, LogFilter, LogQuery, LogSearchResult } from "../types/domain.js";
import { createChildLogger } from "../logger.js";

const log = createChildLogger("log-repository");

export class LogRepository {
  async insert(entries: LogEntry[]): Promise<void> {
    if (entries.length === 0) return;

    // ClickHouse DateTime64(3) does not accept ISO 'Z' suffix — convert to CH format
    const toChTimestamp = (ts: string): string => {
      return new Date(ts).toISOString().replace("T", " ").replace("Z", "");
    };

    await clickhouse.insert({
      table: "logs",
      values: entries.map((e) => ({
        team_id: e.teamId,
        source_id: e.sourceId,
        timestamp: toChTimestamp(e.timestamp),
        level: e.level,
        service: e.service,
        host: e.host,
        message: e.message,
        fields: e.fields,
      })),
      format: "JSONEachRow",
    });

    log.debug({ count: entries.length }, "Logs inserted into ClickHouse");
  }

  async search(query: LogQuery): Promise<LogSearchResult> {
    const startedAt = performance.now();
    const conditions: string[] = [`team_id = {teamId:String}`];
    const params: Record<string, string | number> = { teamId: query.teamId };

    if (query.sourceId) {
      conditions.push(`source_id = {sourceId:String}`);
      params.sourceId = query.sourceId;
    }
    if (query.startTime) {
      conditions.push(`timestamp >= {startTime:String}`);
      params.startTime = query.startTime;
    }
    if (query.endTime) {
      conditions.push(`timestamp <= {endTime:String}`);
      params.endTime = query.endTime;
    }

    if (query.filters) {
      query.filters.forEach((filter, i) => {
        const cond = this.buildFilterCondition(filter, i, params);
        if (cond) conditions.push(cond);
      });
    }

    if (query.query && query.queryType === "sql") {
      conditions.push(
        `(message ILIKE {searchTerm:String} OR service ILIKE {searchTerm:String} OR host ILIKE {searchTerm:String})`,
      );
      params.searchTerm = `%${query.query}%`;
    }

    const where = conditions.join(" AND ");
    const limit = query.limit ?? 100;
    const offset = query.offset ?? 0;
    const sortFieldMap: Record<NonNullable<LogQuery["sortBy"]>, string> = {
      timestamp: "timestamp",
      level: "level",
      service: "service",
      host: "host",
    };
    const sortBy = sortFieldMap[query.sortBy ?? "timestamp"];
    const sortDirection = (query.sortDirection ?? "desc").toUpperCase();

    const countSql = `SELECT count() as total FROM logs WHERE ${where}`;
    const dataSql = `SELECT * FROM logs WHERE ${where} ORDER BY ${sortBy} ${sortDirection}, source_id ${sortDirection} LIMIT {limit:UInt32} OFFSET {offset:UInt32}`;

    params.limit = limit;
    params.offset = offset;

    const [countResult, dataResult] = await Promise.all([
      clickhouse.query({ query: countSql, query_params: params, format: "JSONEachRow" }),
      clickhouse.query({ query: dataSql, query_params: params, format: "JSONEachRow" }),
    ]);

    const countRows = await countResult.json<{ total: string }>();
    const total = Number(countRows[0]?.total ?? 0);

    const rows = await dataResult.json<{
      team_id: string;
      source_id: string;
      timestamp: string;
      level: string;
      service: string;
      host: string;
      message: string;
      fields: Record<string, string>;
    }>();

    const logs: LogEntry[] = rows.map((row) => ({
      id: `${row.team_id}:${row.source_id}:${row.timestamp}`,
      teamId: row.team_id,
      sourceId: row.source_id,
      timestamp: row.timestamp,
      level: row.level as LogEntry["level"],
      service: row.service,
      host: row.host,
      message: row.message,
      fields: row.fields ?? {},
    }));

    const executedQuery = `SELECT * FROM logs WHERE ${where} ORDER BY ${sortBy} ${sortDirection}, source_id ${sortDirection} LIMIT ${limit} OFFSET ${offset}`;

    return {
      logs,
      total,
      query: executedQuery,
      executionTimeMs: Math.round((performance.now() - startedAt) * 100) / 100,
      cached: false,
    };
  }

  async getStats(teamId: string): Promise<{
    totalLogs: number;
    errorRate: number;
    services: Array<{ service: string; count: number }>;
  }> {
    const params = { teamId };

    const [totalResult, errorResult, serviceResult] = await Promise.all([
      clickhouse.query({
        query: `SELECT count() as total FROM logs WHERE team_id = {teamId:String}`,
        query_params: params,
        format: "JSONEachRow",
      }),
      clickhouse.query({
        query: `SELECT count() as errors FROM logs WHERE team_id = {teamId:String} AND level IN ('error', 'fatal')`,
        query_params: params,
        format: "JSONEachRow",
      }),
      clickhouse.query({
        query: `SELECT service, count() as cnt FROM logs WHERE team_id = {teamId:String} GROUP BY service ORDER BY cnt DESC LIMIT 5`,
        query_params: params,
        format: "JSONEachRow",
      }),
    ]);

    const totalRows = await totalResult.json<{ total: string }>();
    const errorRows = await errorResult.json<{ errors: string }>();
    const serviceRows = await serviceResult.json<{ service: string; cnt: string }>();

    const total = Number(totalRows[0]?.total ?? 0);
    const errors = Number(errorRows[0]?.errors ?? 0);

    return {
      totalLogs: total,
      errorRate: total === 0 ? 0 : Number(((errors / total) * 100).toFixed(1)),
      services: serviceRows.map((r) => ({ service: r.service, count: Number(r.cnt) })),
    };
  }

  async getContext(query: {
    teamId: string;
    sourceId: string;
    timestamp: string;
    before: number;
    after: number;
    scope: "source" | "service" | "host";
    service?: string;
    host?: string;
  }): Promise<{ before: LogEntry[]; after: LogEntry[] }> {
    const params: Record<string, string | number> = {
      teamId: query.teamId,
      sourceId: query.sourceId,
      ts: query.timestamp,
      beforeLimit: query.before,
      afterLimit: query.after,
    };
    const scopeConditions: string[] = ["team_id = {teamId:String}"];

    if (query.scope === "source") {
      scopeConditions.push("source_id = {sourceId:String}");
    } else if (query.scope === "service" && query.service) {
      scopeConditions.push("service = {service:String}");
      params.service = query.service;
    } else if (query.scope === "host" && query.host) {
      scopeConditions.push("host = {host:String}");
      params.host = query.host;
    } else {
      scopeConditions.push("source_id = {sourceId:String}");
    }

    const scopeWhere = scopeConditions.join(" AND ");

    const beforeSql = `SELECT * FROM logs WHERE ${scopeWhere} AND timestamp < {ts:String} ORDER BY timestamp DESC, source_id DESC LIMIT {beforeLimit:UInt32}`;
    const afterSql = `SELECT * FROM logs WHERE ${scopeWhere} AND timestamp > {ts:String} ORDER BY timestamp ASC, source_id ASC LIMIT {afterLimit:UInt32}`;

    const [beforeResult, afterResult] = await Promise.all([
      clickhouse.query({ query: beforeSql, query_params: params, format: "JSONEachRow" }),
      clickhouse.query({ query: afterSql, query_params: params, format: "JSONEachRow" }),
    ]);

    const beforeRows = await beforeResult.json<{
      team_id: string;
      source_id: string;
      timestamp: string;
      level: string;
      service: string;
      host: string;
      message: string;
      fields: Record<string, string>;
    }>();
    const afterRows = await afterResult.json<{
      team_id: string;
      source_id: string;
      timestamp: string;
      level: string;
      service: string;
      host: string;
      message: string;
      fields: Record<string, string>;
    }>();

    const mapRow = (row: {
      team_id: string;
      source_id: string;
      timestamp: string;
      level: string;
      service: string;
      host: string;
      message: string;
      fields: Record<string, string>;
    }): LogEntry => ({
      id: `${row.team_id}:${row.source_id}:${row.timestamp}`,
      teamId: row.team_id,
      sourceId: row.source_id,
      timestamp: row.timestamp,
      level: row.level as LogEntry["level"],
      service: row.service,
      host: row.host,
      message: row.message,
      fields: row.fields ?? {},
    });

    return {
      before: beforeRows.map(mapRow).reverse(),
      after: afterRows.map(mapRow),
    };
  }

  private buildFilterCondition(
    filter: LogFilter,
    index: number,
    params: Record<string, string | number>,
  ): string | null {
    const paramName = `f${index}`;
    const columnFields = ["level", "service", "host", "message"];
    const column = columnFields.includes(filter.field) ? filter.field : `fields['${filter.field}']`;

    params[paramName] = filter.value;

    switch (filter.operator) {
      case "eq":
        return `${column} = {${paramName}:String}`;
      case "neq":
        return `${column} != {${paramName}:String}`;
      case "gt":
        return `${column} > {${paramName}:String}`;
      case "lt":
        return `${column} < {${paramName}:String}`;
      case "contains":
        params[paramName] = `%${filter.value}%`;
        return `${column} ILIKE {${paramName}:String}`;
      default:
        return null;
    }
  }
}
