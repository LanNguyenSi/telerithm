/**
 * Form values -> POST /subscriptions payload for the subscriptions page.
 *
 * Mirrors the backend (createSubscriptionSchema in backend/src/validation/schemas.ts
 * and validateSubscriptionWebhook in router.ts): the channel is WEBHOOK, SLACK or
 * MSTEAMS (EMAIL is refused until a mail transport exists), the config key that
 * carries the target is `url` for WEBHOOK and `webhook_url` for SLACK and MSTEAMS,
 * the URL must be an http or https URL (the URL parser already refuses one without a host), and severities are a subset of the
 * four levels (none selected means every severity). The backend stays the
 * authority: it also resolves the host and refuses private, loopback and
 * link-local ranges, which the form cannot check, and the form shows its message.
 */

export const SUBSCRIPTION_CHANNELS = ["WEBHOOK", "SLACK", "MSTEAMS"] as const;
export type SubscriptionChannel = (typeof SUBSCRIPTION_CHANNELS)[number];

export const SUBSCRIPTION_SEVERITIES = ["CRITICAL", "HIGH", "MEDIUM", "LOW"] as const;

export const CHANNEL_LABELS: Record<SubscriptionChannel, string> = {
  WEBHOOK: "Webhook",
  SLACK: "Slack",
  MSTEAMS: "Microsoft Teams",
};

export const URL_LABELS: Record<SubscriptionChannel, string> = {
  WEBHOOK: "Webhook URL",
  SLACK: "Slack webhook URL",
  MSTEAMS: "Teams webhook URL",
};

export interface SubscriptionFormValues {
  /** Empty string means every rule in the team. */
  ruleId: string;
  channel: string;
  url: string;
  secret: string;
  severities: string[];
}

export interface SubscriptionPayload {
  teamId: string;
  ruleId?: string;
  channel: SubscriptionChannel;
  config: Record<string, string>;
  severities: string[];
}

export type SubscriptionFieldName = "ruleId" | "channel" | "url";

export type SubscriptionInputResult =
  | { ok: true; payload: SubscriptionPayload }
  | { ok: false; field: SubscriptionFieldName; message: string };

function isChannel(value: string): value is SubscriptionChannel {
  return (SUBSCRIPTION_CHANNELS as readonly string[]).includes(value);
}

export function buildSubscriptionPayload(
  teamId: string,
  values: SubscriptionFormValues,
  knownRuleIds: readonly string[],
): SubscriptionInputResult {
  if (!isChannel(values.channel)) {
    return { ok: false, field: "channel", message: "Pick Webhook, Slack or Microsoft Teams as the channel." };
  }
  const channel = values.channel;

  if (values.ruleId !== "" && !knownRuleIds.includes(values.ruleId)) {
    return { ok: false, field: "ruleId", message: "Pick a rule from the list, or all rules in the team." };
  }

  const label = URL_LABELS[channel];
  const url = values.url.trim();
  if (url === "") {
    return { ok: false, field: "url", message: `${label} is required.` };
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, field: "url", message: `${label} must be a full URL, for example https://hooks.example.com/alerts.` };
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return { ok: false, field: "url", message: `${label} must start with https:// or http://.` };
  }

  const config: Record<string, string> = channel === "WEBHOOK" ? { url } : { webhook_url: url };
  const secret = values.secret.trim();
  if (channel === "WEBHOOK" && secret !== "") config.secret = secret;

  // Canonical order, no duplicates, unknown values dropped.
  const severities = SUBSCRIPTION_SEVERITIES.filter((level) => values.severities.includes(level));

  return {
    ok: true,
    payload: {
      teamId,
      ...(values.ruleId !== "" ? { ruleId: values.ruleId } : {}),
      channel,
      config,
      severities,
    },
  };
}
