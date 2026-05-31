import { createHmac } from "node:crypto";
import { createChildLogger } from "../../../logger.js";
import { assertSafeUrl } from "../url-guard.js";

const log = createChildLogger("notify-webhook");

export interface WebhookPayload {
  incidentId: string;
  ruleId: string;
  severity: string;
  status: string;
  message: string;
  createdAt: string;
}

export async function sendWebhook(
  url: string,
  payload: WebhookPayload,
  options?: { headers?: Record<string, string>; secret?: string },
): Promise<void> {
  const body = JSON.stringify(payload);
  const reqHeaders: Record<string, string> = {
    "Content-Type": "application/json",
    ...options?.headers,
  };

  // HMAC-SHA256 signature if secret is configured
  if (options?.secret) {
    const signature = createHmac("sha256", options.secret).update(body).digest("hex");
    reqHeaders["X-Telerithm-Signature"] = `sha256=${signature}`;
  }

  // SSRF guard: re-validate at delivery time (DNS may have rebound since the
  // subscription was persisted) and block redirect-based bypass.
  await assertSafeUrl(url);

  const res = await fetch(url, {
    method: "POST",
    headers: reqHeaders,
    body,
    redirect: "manual",
    signal: AbortSignal.timeout(10_000),
  });

  if (!res.ok) {
    throw new Error(`Webhook failed: ${res.status} ${res.statusText}`);
  }

  log.debug({ url, status: res.status }, "Webhook delivered");
}
