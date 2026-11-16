import type {
  AdminUser,
  AlertIncident,
  AlertRule,
  AlertRuleInput,
  AlertSubscription,
  DashboardOverview,
  LogFacet,
  LogHistogramBucket,
  LogPattern,
  NaturalQueryPlan,
  SavedLogView,
  SavedLogViewDefinition,
  SavedLogViewStub,
  Issue,
  LogEntry,
  SessionUser,
  Source,
  SourceType,
  Team,
  TeamWithRole,
} from "@/types";
import { PROXY_BASE_PATH, PROXY_HEADER } from "./proxy-constants";

/**
 * The backend API base URL as the server reaches it: INTERNAL_API_BASE_URL
 * wins, then NEXT_PUBLIC_API_BASE_URL, then the local default.
 */
export function serverApiBaseUrl(env: Record<string, string | undefined> = process.env) {
  return env.INTERNAL_API_BASE_URL ?? env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000/api/v1";
}

export function getApiBaseUrl() {
  if (typeof window === "undefined") {
    return serverApiBaseUrl();
  }

  return process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000/api/v1";
}

/**
 * Credentials of an authenticated call. A server component passes the session
 * token it read from the httpOnly cookie, and the call goes straight to the
 * backend. A client component passes BROWSER_SESSION: the call goes to the
 * same-origin proxy route, which reads the cookie on the server, so the token
 * is never handed to client code or written into a page.
 */
export const BROWSER_SESSION = Object.freeze({ via: "proxy" as const });
export type ApiAuth = string | typeof BROWSER_SESSION;

// Validation failures arrive as a flattened Zod error: top-level `formErrors`
// and per-field `fieldErrors`. Turn it into one readable line.
function describeValidationError(error: Record<string, unknown>, fallback: string): string {
  const messages: string[] = [];
  const isStrings = (value: unknown): value is string[] =>
    Array.isArray(value) && value.every((item) => typeof item === "string");
  if (isStrings(error.formErrors)) messages.push(...error.formErrors);
  if (error.fieldErrors && typeof error.fieldErrors === "object") {
    for (const [field, issues] of Object.entries(error.fieldErrors as Record<string, unknown>)) {
      if (isStrings(issues) && issues.length > 0) messages.push(`${field}: ${issues.join(", ")}`);
    }
  }
  return messages.length > 0 ? messages.join("; ") : fallback;
}

async function request<T>(path: string, init?: RequestInit, baseUrl: string = getApiBaseUrl()): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
    cache: "no-store",
  });

  if (!response.ok) {
    let detail = `API request failed: ${response.status}`;
    try {
      const body = await response.json() as Record<string, unknown>;
      if (typeof body.error === "string") detail = body.error;
      else if (body.error && typeof body.error === "object") detail = describeValidationError(body.error as Record<string, unknown>, detail);
      else if (typeof body.message === "string") detail = body.message;
    } catch { /* no parseable body */ }
    throw new Error(detail);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return response.json() as Promise<T>;
}

function isAsyncEnvelope(value: unknown): value is { requestId: string; status: "pending" } {
  return (
    typeof value === "object" &&
    value !== null &&
    "requestId" in value &&
    typeof (value as { requestId?: unknown }).requestId === "string" &&
    (value as { status?: unknown }).status === "pending"
  );
}

async function waitForAsyncJob<T>(requestId: string, auth: ApiAuth): Promise<T> {
  const attempts = 20;
  const delayMs = 250;

  for (let index = 0; index < attempts; index += 1) {
    const status = await authedRequest<{ status: "pending" | "completed" | "failed"; data?: T; error?: string }>(
      `/query/jobs/${requestId}`,
      auth,
    );
    if (status.status === "completed") {
      return status.data as T;
    }
    if (status.status === "failed") {
      throw new Error(status.error ?? "Async query failed");
    }
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  throw new Error("Async query timed out");
}

function authedRequest<T>(path: string, auth: ApiAuth, init?: RequestInit): Promise<T> {
  if (typeof auth === "string") {
    return request<T>(path, {
      ...init,
      headers: {
        Authorization: `Bearer ${auth}`,
        ...(init?.headers ?? {}),
      },
    });
  }
  return request<T>(
    path,
    {
      ...init,
      headers: {
        [PROXY_HEADER]: "1",
        ...(init?.headers ?? {}),
      },
    },
    PROXY_BASE_PATH,
  );
}

/**
 * The caller as the backend has them in its database. Authorization decisions
 * (the admin pages) read the role from here, never from the `telerithm_user`
 * cookie, which the browser can write.
 */
export async function getCurrentUser(auth: ApiAuth) {
  return authedRequest<{ user: SessionUser }>("/auth/me", auth);
}

export async function getTeams(auth: ApiAuth) {
  return authedRequest<{ teams: TeamWithRole[] }>("/teams", auth);
}

export async function getOverview(teamId: string, auth: ApiAuth) {
  return authedRequest<{ overview: DashboardOverview }>(`/dashboards/overview?teamId=${teamId}`, auth);
}

export async function getSources(teamId: string, auth: ApiAuth) {
  return authedRequest<{ sources: Source[] }>(`/sources?teamId=${teamId}`, auth);
}

export async function createSource(auth: ApiAuth, payload: { teamId: string; name: string; type: SourceType }) {
  return authedRequest<{ source: Source }>("/sources", auth, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function renameSource(id: string, auth: ApiAuth, payload: { name: string }) {
  return authedRequest<{ source: Source }>(`/sources/${encodeURIComponent(id)}`, auth, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export async function deleteSource(id: string, auth: ApiAuth) {
  return authedRequest<void>(`/sources/${encodeURIComponent(id)}`, auth, { method: "DELETE" });
}

// Hard cutover: the response carries the new key, shown to the caller once
// (OWNER and ADMIN can read it again with revealSourceKey); the old key stops
// working at once.
export async function rotateSourceKey(id: string, auth: ApiAuth) {
  return authedRequest<{ source: Source }>(`/sources/${encodeURIComponent(id)}/rotate-key`, auth, {
    method: "POST",
  });
}

// The only read path to a stored ingest key (OWNER and ADMIN; others get 403,
// an unknown or foreign id 404). The backend writes an audit line per call, so
// call it on a click, never to prefetch.
export async function revealSourceKey(id: string, auth: ApiAuth) {
  return authedRequest<{ apiKey: string }>(`/sources/${encodeURIComponent(id)}/reveal`, auth, {
    method: "POST",
  });
}

export interface LogQueryContext {
  currentTimeRange?: { startTime: string; endTime: string };
  currentFilters?: Record<string, string>;
  currentRelativeDuration?: string;
}

export async function getLogs(
  teamId: string,
  auth: ApiAuth,
  options?: {
    sourceId?: string;
    startTime?: string;
    endTime?: string;
    query?: string;
    filters?: Array<{
      field: string;
      operator: "eq" | "neq" | "gt" | "lt" | "contains";
      value: string | number;
    }>;
    sortBy?: "timestamp" | "level" | "service" | "host";
    sortDirection?: "asc" | "desc";
    limit?: number;
    offset?: number;
    pageToken?: string;
    /** Form state context hints, only used in natural mode */
    context?: LogQueryContext;
  },
) {
  const isNatural = Boolean(options?.query);
  return authedRequest<{
    logs: LogEntry[];
    total: number;
    requestId: string;
    partial: boolean;
    query: string;
    executionTimeMs: number;
    cached: boolean;
    nextPageToken?: string;
  }>("/logs/search", auth, {
    method: "POST",
    body: JSON.stringify({
      teamId,
      sourceId: options?.sourceId || undefined,
      startTime: isNatural ? undefined : options?.startTime || undefined,
      endTime: isNatural ? undefined : options?.endTime || undefined,
      query: options?.query || undefined,
      queryType: isNatural ? "natural" : "sql",
      // Natural mode: no user filters — AI decides; Manual mode: pass filters directly
      filters: isNatural ? undefined : options?.filters,
      // Natural mode: pass form state as context hints
      context: isNatural ? options?.context : undefined,
      sortBy: options?.sortBy ?? "timestamp",
      sortDirection: options?.sortDirection ?? "desc",
      limit: options?.limit ?? 50,
      offset: options?.offset ?? 0,
      pageToken: options?.pageToken || undefined,
    }),
  });
}

export async function getLogById(teamId: string, logId: string, auth: ApiAuth) {
  return authedRequest<{ log: LogEntry }>(`/logs/${logId}?teamId=${teamId}`, auth);
}

export async function getNaturalExplanation(teamId: string, query: string, auth: ApiAuth) {
  return authedRequest<NaturalQueryPlan>("/query/natural", auth, {
    method: "POST",
    body: JSON.stringify({ teamId, query }),
  });
}

export async function getLogFacets(
  teamId: string,
  auth: ApiAuth,
  options?: {
    sourceId?: string;
    startTime?: string;
    endTime?: string;
    query?: string;
    filters?: Array<{
      field: string;
      operator: "eq" | "neq" | "gt" | "lt" | "contains";
      value: string | number;
    }>;
    fields?: Array<"service" | "level" | "host" | "sourceId" | "env" | "region" | "status_code" | "route">;
    limit?: number;
  },
) {
  const response = await authedRequest<{ facets: LogFacet[] } | { requestId: string; status: "pending" }>(
    "/logs/facets",
    auth,
    {
      method: "POST",
      body: JSON.stringify({
        teamId,
        sourceId: options?.sourceId || undefined,
        startTime: options?.startTime || undefined,
        endTime: options?.endTime || undefined,
        query: options?.query || undefined,
        queryType: options?.query ? "natural" : "sql",
        filters: options?.filters,
        fields: options?.fields,
        limit: options?.limit ?? 10,
      }),
    },
  );
  if (isAsyncEnvelope(response)) {
    return waitForAsyncJob<{ facets: LogFacet[] }>(response.requestId, auth);
  }
  return response;
}

export async function getLogHistogram(
  teamId: string,
  auth: ApiAuth,
  options?: {
    sourceId?: string;
    startTime?: string;
    endTime?: string;
    query?: string;
    filters?: Array<{
      field: string;
      operator: "eq" | "neq" | "gt" | "lt" | "contains";
      value: string | number;
    }>;
    interval?: "minute" | "5m" | "15m" | "hour" | "day";
  },
) {
  const response = await authedRequest<
    | {
        interval: "minute" | "5m" | "15m" | "hour" | "day";
        buckets: LogHistogramBucket[];
      }
    | { requestId: string; status: "pending" }
  >("/logs/histogram", auth, {
    method: "POST",
    body: JSON.stringify({
      teamId,
      sourceId: options?.sourceId || undefined,
      startTime: options?.startTime || undefined,
      endTime: options?.endTime || undefined,
      query: options?.query || undefined,
      queryType: options?.query ? "natural" : "sql",
      filters: options?.filters,
      interval: options?.interval ?? "5m",
    }),
  });
  if (isAsyncEnvelope(response)) {
    return waitForAsyncJob<{
      interval: "minute" | "5m" | "15m" | "hour" | "day";
      buckets: LogHistogramBucket[];
    }>(response.requestId, auth);
  }
  return response;
}

export async function getLogPatterns(
  teamId: string,
  auth: ApiAuth,
  options?: {
    sourceId?: string;
    startTime?: string;
    endTime?: string;
    query?: string;
    filters?: Array<{
      field: string;
      operator: "eq" | "neq" | "gt" | "lt" | "contains";
      value: string | number;
    }>;
    groupBy?: "none" | "service" | "level" | "service_level";
    limit?: number;
  },
) {
  const response = await authedRequest<{ patterns: LogPattern[] } | { requestId: string; status: "pending" }>(
    "/logs/patterns",
    auth,
    {
      method: "POST",
      body: JSON.stringify({
        teamId,
        sourceId: options?.sourceId || undefined,
        startTime: options?.startTime || undefined,
        endTime: options?.endTime || undefined,
        query: options?.query || undefined,
        queryType: options?.query ? "natural" : "sql",
        filters: options?.filters,
        groupBy: options?.groupBy ?? "service_level",
        limit: options?.limit ?? 50,
      }),
    },
  );
  if (isAsyncEnvelope(response)) {
    return waitForAsyncJob<{ patterns: LogPattern[] }>(response.requestId, auth);
  }
  return response;
}

export async function getSavedLogViews(teamId: string, auth: ApiAuth) {
  return authedRequest<{ views: SavedLogView[] }>(`/logs/views?teamId=${encodeURIComponent(teamId)}`, auth);
}

export async function createSavedLogView(
  auth: ApiAuth,
  payload: {
    teamId: string;
    name: string;
    isShared: boolean;
    isDefault: boolean;
    definition: SavedLogViewDefinition;
  },
) {
  return authedRequest<{ view: SavedLogView }>("/logs/views", auth, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function updateSavedLogView(
  id: string,
  teamId: string,
  auth: ApiAuth,
  payload: Partial<{
    name: string;
    isShared: boolean;
    isDefault: boolean;
    definition: SavedLogViewDefinition;
  }>,
) {
  return authedRequest<{ view: SavedLogView | SavedLogViewStub }>(
    `/logs/views/${id}?teamId=${encodeURIComponent(teamId)}`,
    auth,
    {
      method: "PUT",
      body: JSON.stringify({ teamId, ...payload }),
    },
  );
}

export async function duplicateSavedLogView(
  id: string,
  auth: ApiAuth,
  payload: { teamId: string; name?: string },
) {
  return authedRequest<{ view: SavedLogView }>(`/logs/views/${id}/duplicate`, auth, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function deleteSavedLogView(id: string, teamId: string, auth: ApiAuth) {
  return authedRequest<void>(`/logs/views/${id}?teamId=${encodeURIComponent(teamId)}`, auth, {
    method: "DELETE",
  });
}

export async function getLogContext(
  auth: ApiAuth,
  options: {
    teamId: string;
    sourceId: string;
    timestamp: string;
    before?: number;
    after?: number;
    scope?: "source" | "service" | "host";
    service?: string;
    host?: string;
  },
) {
  return authedRequest<{
    before: LogEntry[];
    after: LogEntry[];
  }>("/logs/context", auth, {
    method: "POST",
    body: JSON.stringify({
      teamId: options.teamId,
      sourceId: options.sourceId,
      timestamp: options.timestamp,
      before: options.before ?? 20,
      after: options.after ?? 20,
      scope: options.scope ?? "source",
      service: options.service,
      host: options.host,
    }),
  });
}

export async function getAlertRules(teamId: string, auth: ApiAuth) {
  return authedRequest<{ rules: AlertRule[] }>(`/alerts/rules?teamId=${teamId}`, auth);
}

export async function createAlertRule(auth: ApiAuth, payload: AlertRuleInput & { teamId: string }) {
  return authedRequest<{ rule: AlertRule }>("/alerts/rules", auth, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

/** Partial update: only the keys present are changed. `description: null` clears it. */
export async function updateAlertRule(
  id: string,
  auth: ApiAuth,
  payload: Partial<Omit<AlertRuleInput, "description">> & { description?: string | null },
) {
  return authedRequest<{ rule: AlertRule }>(`/alerts/rules/${encodeURIComponent(id)}`, auth, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export async function deleteAlertRule(id: string, auth: ApiAuth) {
  return authedRequest<void>(`/alerts/rules/${encodeURIComponent(id)}`, auth, { method: "DELETE" });
}

export async function getAlertIncidents(teamId: string, auth: ApiAuth) {
  return authedRequest<{ incidents: AlertIncident[] }>(`/alerts/incidents?teamId=${teamId}`, auth);
}

export async function getSubscriptions(teamId: string, auth: ApiAuth) {
  return authedRequest<{ subscriptions: AlertSubscription[] }>(`/subscriptions?teamId=${teamId}`, auth);
}

export async function createSubscription(
  auth: ApiAuth,
  data: {
    teamId: string;
    ruleId?: string;
    channel: string;
    config: Record<string, unknown>;
    severities?: string[];
  },
) {
  return authedRequest<{ subscription: AlertSubscription }>("/subscriptions", auth, {
    method: "POST",
    body: JSON.stringify(data),
  });
}

/** Partial update: only the keys present change. `enabled` switches delivery off and on. */
export async function updateSubscription(
  id: string,
  auth: ApiAuth,
  data: { channel?: string; config?: Record<string, unknown>; severities?: string[]; enabled?: boolean },
) {
  return authedRequest<{ subscription: AlertSubscription }>(`/subscriptions/${encodeURIComponent(id)}`, auth, {
    method: "PUT",
    body: JSON.stringify(data),
  });
}

export async function deleteSubscription(id: string, auth: ApiAuth) {
  return authedRequest<void>(`/subscriptions/${id}`, auth, { method: "DELETE" });
}

/** Sends a synthetic notification to the caller's own subscription (rate limited by the API). */
export async function testSubscription(id: string, auth: ApiAuth) {
  return authedRequest<{ ok: boolean; message: string }>(`/subscriptions/${encodeURIComponent(id)}/test`, auth, {
    method: "POST",
  });
}

export async function getIssues(
  teamId: string,
  auth: ApiAuth,
  options?: {
    query?: string;
    status?: string;
    service?: string;
    level?: string;
    sortBy?: "lastSeen" | "firstSeen" | "eventCount" | "service" | "level" | "status";
    sortDirection?: "asc" | "desc";
    limit?: number;
    offset?: number;
  },
) {
  const params = new URLSearchParams({ teamId });
  if (options?.query) params.set("query", options.query);
  if (options?.status) params.set("status", options.status);
  if (options?.service) params.set("service", options.service);
  if (options?.level) params.set("level", options.level);
  if (options?.sortBy) params.set("sortBy", options.sortBy);
  if (options?.sortDirection) params.set("sortDirection", options.sortDirection);
  if (options?.limit) params.set("limit", String(options.limit));
  if (options?.offset) params.set("offset", String(options.offset));
  return authedRequest<{ issues: Issue[]; total: number }>(`/issues?${params.toString()}`, auth);
}

export async function getRegistrationSettings() {
  return request<{ registrationMode: "open" | "invite-only" | "approval" }>("/auth/settings");
}

export async function getAdminUsers(auth: ApiAuth) {
  return authedRequest<{ users: AdminUser[] }>("/admin/users", auth);
}

export async function getAdminTeams(auth: ApiAuth) {
  return authedRequest<{ teams: Array<Team & { memberCount: number }> }>("/admin/teams", auth);
}

export async function approveAdminUser(userId: string, auth: ApiAuth) {
  return authedRequest<{ user: SessionUser }>(`/admin/users/${userId}/approve`, auth, {
    method: "POST",
  });
}

export async function addAdminUserToTeam(
  userId: string,
  auth: ApiAuth,
  data: { teamId: string; role: "OWNER" | "ADMIN" | "MEMBER" | "VIEWER" },
) {
  return authedRequest<{ membership: { id: string } }>(`/admin/users/${userId}/add-to-team`, auth, {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function removeAdminUserFromTeam(userId: string, teamId: string, auth: ApiAuth) {
  return authedRequest<void>(`/admin/users/${userId}/remove-from-team/${teamId}`, auth, {
    method: "DELETE",
  });
}

/**
 * A one-time ticket that opens the live-tail stream for one team. EventSource
 * cannot send headers, and the session token must not go into a URL, so the
 * stream authenticates with this instead: valid for about a minute, spent by
 * its first use. Ask for a new one before every connection, reconnects
 * included.
 */
export async function createStreamTicket(teamId: string, auth: ApiAuth) {
  return authedRequest<{ ticket: string; expiresInSeconds: number }>("/stream/ticket", auth, {
    method: "POST",
    body: JSON.stringify({ teamId }),
  });
}

export function streamLogs(
  teamId: string,
  ticket: string,
  filters?: {
    sourceId?: string;
    service?: string;
    host?: string;
    level?: string;
    query?: string;
  },
) {
  const params = new URLSearchParams({ teamId, ticket });
  if (filters?.sourceId) params.set("sourceId", filters.sourceId);
  if (filters?.service) params.set("service", filters.service);
  if (filters?.host) params.set("host", filters.host);
  if (filters?.level) params.set("level", filters.level);
  if (filters?.query) params.set("query", filters.query);
  return new EventSource(`${getApiBaseUrl()}/stream/logs?${params.toString()}`);
}
