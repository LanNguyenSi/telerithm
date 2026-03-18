import type { AlertIncident, AlertRule, DashboardOverview, LogEntry, Source, Team } from "@/types";

function getApiBaseUrl() {
  if (typeof window === "undefined") {
    return (
      process.env.INTERNAL_API_BASE_URL ??
      process.env.NEXT_PUBLIC_API_BASE_URL ??
      "http://localhost:4000/api/v1"
    );
  }

  return process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000/api/v1";
}

export const demoCredentials = {
  email: "demo@logforge.dev",
  password: "demo123",
};

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

  return response.json() as Promise<T>;
}

export async function login() {
  return request<{ token: string; user: { id: string; email: string; name: string } }>(
    "/auth/login",
    {
      method: "POST",
      body: JSON.stringify(demoCredentials),
    },
  );
}

export async function getTeams(token: string) {
  return request<{ teams: Team[] }>("/teams", {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
}

export async function getOverview(teamId: string) {
  return request<{ overview: DashboardOverview }>(`/dashboards/overview?teamId=${teamId}`);
}

export async function getSources(teamId: string) {
  return request<{ sources: Source[] }>(`/sources?teamId=${teamId}`);
}

export async function getLogs(teamId: string, query?: string) {
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
      query: query || undefined,
      queryType: query ? "natural" : "sql",
      limit: 100,
      offset: 0,
    }),
  });
}

export async function getNaturalExplanation(teamId: string, query: string) {
  return request<{ sql: string; explanation: string; filtersApplied: Array<{ field: string; operator: string; value: string | number }> }>(
    "/query/natural",
    {
      method: "POST",
      body: JSON.stringify({ teamId, query }),
    },
  );
}

export async function getAlertRules(teamId: string) {
  return request<{ rules: AlertRule[] }>(`/alerts/rules?teamId=${teamId}`);
}

export async function getAlertIncidents(teamId: string) {
  return request<{ incidents: AlertIncident[] }>(`/alerts/incidents?teamId=${teamId}`);
}

export function streamLogs(teamId: string) {
  return new EventSource(`${getApiBaseUrl()}/stream/logs?teamId=${teamId}`);
}
