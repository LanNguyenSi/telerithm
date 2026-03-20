export interface TransportConfig {
  endpoint: string;
  apiKey: string;
  timeout?: number;
}

export interface LogPayload {
  logs: Array<{
    timestamp: string;
    level: string;
    service?: string;
    host?: string;
    message: string;
    fields?: Record<string, string | number | boolean>;
  }>;
}

export async function sendBatch(config: TransportConfig, payload: LogPayload): Promise<boolean> {
  try {
    const res = await fetch(config.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": config.apiKey,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(config.timeout ?? 10_000),
    });
    return res.ok;
  } catch {
    return false;
  }
}
