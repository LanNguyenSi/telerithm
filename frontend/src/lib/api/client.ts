import type {
  AdminUser,
  AlertIncident,
  AlertRule,
  AlertSubscription,
  DashboardOverview,
  LogFacet,
  LogHistogramBucket,
  LogPattern,
  NaturalQueryPlan,
  SavedLogView,
  SavedLogViewDefinition,
  Issue,
  LogEntry,
  SessionUser,
  Source,
  Team,
} from "@/types";

export function getApiBaseUrl() {
  if (typeof window === "undefined") {
    return (
      process.env.INTERNAL_API_BASE_URL ??
      process.env.NEXT_PUBLIC_API_BASE_URL ??
      "http://localhost:4000/api/v1"
    );
  }

  return process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000/api/v1";
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${getApiBaseUrl()}${path}`, {
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

async function waitForAsyncJob<T>(requestId: string, token: string): Promise<T> {
  const attempts = 20;
  const delayMs = 250;

  for (let index = 0; index < attempts; index += 1) {
    const status = await authedRequest<{ status: "pending" | "completed" | "failed"; data?: T; error?: string }>(
      `/query/jobs/${requestId}`,
      token,
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

function authedRequest<T>(path: string, token: string, init?: RequestInit): Promise<T> {
  return request<T>(path, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init?.headers ?? {}),
    },
  });
}

export async function getTeams(token: string) {
  return authedRequest<{ teams: Team[] }>("/teams", token);
}

export async function getOverview(teamId: string, token: string) {
  return authedRequest<{ overview: DashboardOverview }>(`/dashboards/overview?teamId=${teamId}`, token);
}

export async function getSources(teamId: string, token: string) {
  return authedRequest<{ sources: Source[] }>(`/sources?teamId=${teamId}`, token);
}

export interface LogQueryContext {
  currentTimeRange?: { startTime: string; endTime: string };
  currentFilters?: Record<string, string>;
  currentRelativeDuration?: string;
}

export async function getLogs(
  teamId: string,
  token: string,
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
  }>("/logs/search", token, {
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

export async function getLogById(teamId: string, logId: string, token: string) {
  return authedRequest<{ log: LogEntry }>(`/logs/${logId}?teamId=${teamId}`, token);
}

export async function getNaturalExplanation(teamId: string, query: string, token: string) {
  return authedRequest<NaturalQueryPlan>("/query/natural", token, {
    method: "POST",
    body: JSON.stringify({ teamId, query }),
  });
}

export async function getLogFacets(
  teamId: string,
  token: string,
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
    token,
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
    return waitForAsyncJob<{ facets: LogFacet[] }>(response.requestId, token);
  }
  return response;
}

export async function getLogHistogram(
  teamId: string,
  token: string,
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
  >("/logs/histogram", token, {
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
    }>(response.requestId, token);
  }
  return response;
}

export async function getLogPatterns(
  teamId: string,
  token: string,
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
    token,
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
    return waitForAsyncJob<{ patterns: LogPattern[] }>(response.requestId, token);
  }
  return response;
}

export async function getSavedLogViews(teamId: string, token: string) {
  return authedRequest<{ views: SavedLogView[] }>(`/logs/views?teamId=${encodeURIComponent(teamId)}`, token);
}

export async function createSavedLogView(
  token: string,
  payload: {
    teamId: string;
    name: string;
    isShared: boolean;
    isDefault: boolean;
    definition: SavedLogViewDefinition;
  },
) {
  return authedRequest<{ view: SavedLogView }>("/logs/views", token, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function updateSavedLogView(
  id: string,
  teamId: string,
  token: string,
  payload: Partial<{
    name: string;
    isShared: boolean;
    isDefault: boolean;
    definition: SavedLogViewDefinition;
  }>,
) {
  return authedRequest<{ view: SavedLogView }>(
    `/logs/views/${id}?teamId=${encodeURIComponent(teamId)}`,
    token,
    {
      method: "PUT",
      body: JSON.stringify({ teamId, ...payload }),
    },
  );
}

export async function duplicateSavedLogView(
  id: string,
  token: string,
  payload: { teamId: string; name?: string },
) {
  return authedRequest<{ view: SavedLogView }>(`/logs/views/${id}/duplicate`, token, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function deleteSavedLogView(id: string, teamId: string, token: string) {
  return authedRequest<void>(`/logs/views/${id}?teamId=${encodeURIComponent(teamId)}`, token, {
    method: "DELETE",
  });
}

export async function getLogContext(
  token: string,
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
  }>("/logs/context", token, {
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

export async function getAlertRules(teamId: string, token: string) {
  return authedRequest<{ rules: AlertRule[] }>(`/alerts/rules?teamId=${teamId}`, token);
}

export async function getAlertIncidents(teamId: string, token: string) {
  return authedRequest<{ incidents: AlertIncident[] }>(`/alerts/incidents?teamId=${teamId}`, token);
}

export async function getSubscriptions(teamId: string, token: string) {
  return authedRequest<{ subscriptions: AlertSubscription[] }>(`/subscriptions?teamId=${teamId}`, token);
}

export async function createSubscription(
  token: string,
  data: {
    teamId: string;
    ruleId?: string;
    channel: string;
    config: Record<string, unknown>;
    severities?: string[];
  },
) {
  return authedRequest<{ subscription: AlertSubscription }>("/subscriptions", token, {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function deleteSubscription(id: string, token: string) {
  return authedRequest<void>(`/subscriptions/${id}`, token, { method: "DELETE" });
}

export async function getIssues(
  teamId: string,
  token: string,
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
  return authedRequest<{ issues: Issue[]; total: number }>(`/issues?${params.toString()}`, token);
}

export async function getRegistrationSettings() {
  return request<{ registrationMode: "open" | "invite-only" | "approval" }>("/auth/settings");
}

export async function getAdminUsers(token: string) {
  return authedRequest<{ users: AdminUser[] }>("/admin/users", token);
}

export async function getAdminTeams(token: string) {
  return authedRequest<{ teams: Array<Team & { memberCount: number }> }>("/admin/teams", token);
}

export async function approveAdminUser(userId: string, token: string) {
  return authedRequest<{ user: SessionUser }>(`/admin/users/${userId}/approve`, token, {
    method: "POST",
  });
}

export async function addAdminUserToTeam(
  userId: string,
  token: string,
  data: { teamId: string; role: "OWNER" | "ADMIN" | "MEMBER" | "VIEWER" },
) {
  return authedRequest<{ membership: { id: string } }>(`/admin/users/${userId}/add-to-team`, token, {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function removeAdminUserFromTeam(userId: string, teamId: string, token: string) {
  return authedRequest<void>(`/admin/users/${userId}/remove-from-team/${teamId}`, token, {
    method: "DELETE",
  });
}

export function streamLogs(
  teamId: string,
  token: string,
  filters?: {
    sourceId?: string;
    service?: string;
    host?: string;
    level?: string;
    query?: string;
  },
) {
  // EventSource can't set headers, so the backend /stream/logs handler
  // accepts the bearer via ?token=. Backend http logger redacts it.
  const params = new URLSearchParams({ teamId, token });
  if (filters?.sourceId) params.set("sourceId", filters.sourceId);
  if (filters?.service) params.set("service", filters.service);
  if (filters?.host) params.set("host", filters.host);
  if (filters?.level) params.set("level", filters.level);
  if (filters?.query) params.set("query", filters.query);
  return new EventSource(`${getApiBaseUrl()}/stream/logs?${params.toString()}`);
}
