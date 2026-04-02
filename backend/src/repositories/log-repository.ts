import { clickhouse } from "./clickhouse.js";
import type {
  LogEntry,
  LogFacet,
  LogFacetQuery,
  LogFilter,
  LogHistogramQuery,
  LogHistogramResult,
  LogPattern,
  LogPatternsQuery,
  LogPatternsResult,
  LogQuery,
  LogSearchResult,
} from "../types/domain.js";
import { createChildLogger } from "../logger.js";
import { patternSignatureSqlExpression } from "../services/query/pattern-normalizer.js";

const log = createChildLogger("log-repository");
const SEARCHABLE_COLUMNS = new Set(["level", "service", "host", "message"]);
const FACET_FIELD_REGISTRY: Record<string, string> = {
  service: "service",
  level: "level",
  host: "host",
  sourceId: "source_id",
  env: "fields['env']",
  region: "fields['region']",
  status_code: "fields['status_code']",
  route: "fields['route']",
};

const HISTOGRAM_INTERVAL_SQL: Record<LogHistogramQuery["interval"], string> = {
  minute: "INTERVAL 1 MINUTE",
  "5m": "INTERVAL 5 MINUTE",
  "15m": "INTERVAL 15 MINUTE",
  hour: "INTERVAL 1 HOUR",
  day: "INTERVAL 1 DAY",
};

const HISTOGRAM_INTERVAL_MS: Record<LogHistogramQuery["interval"], number> = {
  minute: 60_000,
  "5m": 5 * 60_000,
  "15m": 15 * 60_000,
  hour: 60 * 60_000,
  day: 24 * 60 * 60_000,
};

export class LogRepository {
  async insert(entries: LogEntry[]): Promise<void> {
    if (entries.length === 0) return;

    const toChTimestamp = (ts: string): string => this.toChTimestamp(ts);

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
    const { where, params } = this.buildScopedWhere(query);
    const limit = query.limit ?? 100;
    const offset = this.resolveOffset(query);
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
      requestId: "",
      partial: false,
      query: executedQuery,
      executionTimeMs: Math.round((performance.now() - startedAt) * 100) / 100,
      cached: false,
      nextPageToken: offset + limit < total ? this.encodePageToken(offset + limit) : undefined,
    };
  }

  async getFacets(query: LogFacetQuery): Promise<{ facets: LogFacet[] }> {
    const requestedFields = (query.fields ?? ["service", "level", "host", "sourceId"]).filter(
      (field, index, allFields) => allFields.indexOf(field) === index && field in FACET_FIELD_REGISTRY,
    );
    if (requestedFields.length === 0) {
      return { facets: [] };
    }

    const facetLimit = query.limit ?? 10;
    const { where, params } = this.buildScopedWhere(query);

    const facets = await Promise.all(
      requestedFields.map(async (field) => {
        const expression = FACET_FIELD_REGISTRY[field];
        const sql = `SELECT toString(${expression}) as value, count() as count FROM logs WHERE ${where} AND lengthUTF8(toString(${expression})) > 0 GROUP BY value ORDER BY count DESC LIMIT {facetLimit:UInt32}`;
        const result = await clickhouse.query({
          query: sql,
          query_params: { ...params, facetLimit },
          format: "JSONEachRow",
        });
        const rows = await result.json<{ value: string; count: string }>();

        return {
          field,
          buckets: rows.map((row) => ({ value: row.value, count: Number(row.count) })),
        } satisfies LogFacet;
      }),
    );

    return { facets };
  }

  async getHistogram(query: LogHistogramQuery): Promise<LogHistogramResult> {
    const { where, params } = this.buildScopedWhere(query);
    const intervalSql = HISTOGRAM_INTERVAL_SQL[query.interval];
    const bucketMs = HISTOGRAM_INTERVAL_MS[query.interval];
    const sql = `SELECT toStartOfInterval(timestamp, ${intervalSql}) as bucket_start, count() as count FROM logs WHERE ${where} GROUP BY bucket_start ORDER BY bucket_start ASC`;
    const result = await clickhouse.query({
      query: sql,
      query_params: params,
      format: "JSONEachRow",
    });

    const rows = await result.json<{ bucket_start: string; count: string }>();
    return {
      interval: query.interval,
      buckets: rows.map((row) => {
        const startIso = this.toIsoTimestamp(row.bucket_start);
        const endIso = new Date(new Date(startIso).getTime() + bucketMs).toISOString();
        return {
          start: startIso,
          end: endIso,
          count: Number(row.count),
        };
      }),
    };
  }

  async getPatterns(query: LogPatternsQuery): Promise<LogPatternsResult> {
    const { where, params } = this.buildScopedWhere(query);
    const limit = query.limit ?? 50;
    const groupBy = query.groupBy ?? "service_level";
    const signatureExpr = this.patternSignatureExpression();

    const groupFields: string[] = ["signature"];
    const selectFields: string[] = [
      `${signatureExpr} as signature`,
      "any(message) as sample_message",
      "count() as count",
      "max(timestamp) as latest_timestamp",
      "any(host) as sample_host",
    ];

    if (groupBy === "service" || groupBy === "service_level") {
      groupFields.push("service");
      selectFields.push("service");
    } else {
      selectFields.push("'' as service");
    }

    if (groupBy === "level" || groupBy === "service_level") {
      groupFields.push("level");
      selectFields.push("level");
    } else {
      selectFields.push("'' as level");
    }

    const sql = `SELECT ${selectFields.join(", ")} FROM logs WHERE ${where} GROUP BY ${groupFields.join(", ")} ORDER BY count DESC, latest_timestamp DESC LIMIT {patternLimit:UInt32}`;
    const result = await clickhouse.query({
      query: sql,
      query_params: { ...params, patternLimit: limit },
      format: "JSONEachRow",
    });

    const rows = await result.json<{
      signature: string;
      sample_message: string;
      count: string;
      latest_timestamp: string;
      service: string;
      level: string;
      sample_host: string;
    }>();

    const patterns: LogPattern[] = rows.map((row) => {
      const keyParts = [row.signature];
      if (row.service) keyParts.unshift(row.service);
      if (row.level) keyParts.unshift(row.level);

      return {
        key: keyParts.join("|"),
        signature: row.signature,
        sampleMessage: row.sample_message,
        count: Number(row.count),
        latestTimestamp: this.toIsoTimestamp(row.latest_timestamp),
        service: row.service || undefined,
        level: row.level || undefined,
        host: row.sample_host || undefined,
      };
    });

    return { patterns };
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
      ts: this.toChTimestamp(query.timestamp),
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
    if (filter.field === "__pattern") {
      const signatureColumn = this.patternSignatureExpression();
      if (filter.operator === "eq" || filter.operator === "neq") {
        params[paramName] = String(filter.value).toLowerCase();
        return `${signatureColumn} ${filter.operator === "eq" ? "=" : "!="} {${paramName}:String}`;
      }
      if (filter.operator === "contains") {
        params[paramName] = `%${String(filter.value).toLowerCase()}%`;
        return `${signatureColumn} ILIKE {${paramName}:String}`;
      }
      return null;
    }

    const column = SEARCHABLE_COLUMNS.has(filter.field) ? filter.field : `fields['${filter.field}']`;

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

  private toChTimestamp(ts: string): string {
    return new Date(ts).toISOString().replace("T", " ").replace("Z", "");
  }

  private buildScopedWhere(query: {
    teamId: string;
    sourceId?: string;
    startTime?: string;
    endTime?: string;
    query?: string;
    queryType: "sql" | "natural";
    filters?: LogFilter[];
  }): { where: string; params: Record<string, string | number> } {
    const conditions: string[] = [`team_id = {teamId:String}`];
    const params: Record<string, string | number> = { teamId: query.teamId };

    if (query.sourceId) {
      conditions.push(`source_id = {sourceId:String}`);
      params.sourceId = query.sourceId;
    }
    if (query.startTime) {
      conditions.push(`timestamp >= {startTime:String}`);
      params.startTime = this.toChTimestamp(query.startTime);
    }
    if (query.endTime) {
      conditions.push(`timestamp <= {endTime:String}`);
      params.endTime = this.toChTimestamp(query.endTime);
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

    return { where: conditions.join(" AND "), params };
  }

  private toIsoTimestamp(value: string): string {
    const normalized = value.includes("T") ? value : value.replace(" ", "T");
    return new Date(normalized.endsWith("Z") ? normalized : `${normalized}Z`).toISOString();
  }

  private patternSignatureExpression(): string {
    return patternSignatureSqlExpression("message");
  }

  private resolveOffset(query: LogQuery): number {
    if (!query.pageToken) {
      return query.offset ?? 0;
    }
    try {
      const parsed = JSON.parse(Buffer.from(query.pageToken, "base64url").toString("utf8")) as {
        offset?: number;
      };
      if (typeof parsed.offset === "number" && parsed.offset >= 0) {
        return parsed.offset;
      }
    } catch {
      /* ignore invalid token and fallback */
    }
    return query.offset ?? 0;
  }

  private encodePageToken(offset: number): string {
    return Buffer.from(JSON.stringify({ offset }), "utf8").toString("base64url");
  }

  async findById(teamId: string, compositeId: string): Promise<LogEntry | null> {
    // Composite ID format: team_id:source_id:timestamp
    // Note: timestamp contains colons (e.g. 2026-04-01 16:48:11.370)
    // So we split on first two colons only
    const firstColon = compositeId.indexOf(":");
    if (firstColon === -1) return null;
    const secondColon = compositeId.indexOf(":", firstColon + 1);
    if (secondColon === -1) return null;

    const idTeamId = compositeId.slice(0, firstColon);
    const sourceId = compositeId.slice(firstColon + 1, secondColon);
    const timestamp = compositeId.slice(secondColon + 1);

    if (idTeamId !== teamId) return null;

    const resultSet = await clickhouse.query({
      query: `SELECT team_id, source_id, timestamp, level, service, host, message, fields
              FROM logs
              WHERE team_id = {teamId:String}
                AND source_id = {sourceId:String}
                AND timestamp = {timestamp:String}
              LIMIT 1`,
      query_params: { teamId, sourceId, timestamp },
      format: "JSONEachRow",
    });

    const rows = await resultSet.json<{
      team_id: string;
      source_id: string;
      timestamp: string;
      level: string;
      service: string;
      host: string;
      message: string;
      fields: Record<string, string>;
    }>();

    if (rows.length === 0) return null;

    const row = rows[0]!;
    return {
      id: compositeId,
      teamId: row.team_id,
      sourceId: row.source_id,
      timestamp: row.timestamp,
      level: row.level as LogEntry["level"],
      service: row.service,
      host: row.host,
      message: row.message,
      fields: row.fields ?? {},
    };
  }
}
