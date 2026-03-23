import type {
  AdminUser,
  AlertIncident,
  AlertRule,
  AlertSubscription,
  DashboardOverview,
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
    throw new Error(`API request failed: ${response.status}`);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return response.json() as Promise<T>;
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

export async function getOverview(teamId: string) {
  return request<{ overview: DashboardOverview }>(`/dashboards/overview?teamId=${teamId}`);
}

export async function getSources(teamId: string) {
  return request<{ sources: Source[] }>(`/sources?teamId=${teamId}`);
}

export async function getLogs(
  teamId: string,
  options?: {
    query?: string;
    limit?: number;
    offset?: number;
  },
) {
  return request<{
    logs: LogEntry[];
    total: number;
    query: string;
    executionTimeMs: number;
    cached: boolean;
  }>("/logs/search", {
    method: "POST",
    body: JSON.stringify({
      teamId,
      query: options?.query || undefined,
      queryType: options?.query ? "natural" : "sql",
      limit: options?.limit ?? 50,
      offset: options?.offset ?? 0,
    }),
  });
}

export async function getNaturalExplanation(teamId: string, query: string) {
  return request<{
    sql: string;
    explanation: string;
    filtersApplied: Array<{ field: string; operator: string; value: string | number }>;
  }>("/query/natural", {
    method: "POST",
    body: JSON.stringify({ teamId, query }),
  });
}

export async function getAlertRules(teamId: string) {
  return request<{ rules: AlertRule[] }>(`/alerts/rules?teamId=${teamId}`);
}

export async function getAlertIncidents(teamId: string) {
  return request<{ incidents: AlertIncident[] }>(`/alerts/incidents?teamId=${teamId}`);
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

export async function getIssues(teamId: string, filters?: { status?: string; service?: string }) {
  const params = new URLSearchParams({ teamId });
  if (filters?.status) params.set("status", filters.status);
  if (filters?.service) params.set("service", filters.service);
  return request<{ issues: Issue[]; total: number }>(`/issues?${params.toString()}`);
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

export function streamLogs(teamId: string) {
  return new EventSource(`${getApiBaseUrl()}/stream/logs?teamId=${teamId}`);
}
