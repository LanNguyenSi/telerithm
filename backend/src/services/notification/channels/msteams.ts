import { createChildLogger } from "../../../logger.js";
import { safeFetch } from "../safe-fetch.js";
import { ChannelHttpError } from "./errors.js";

const log = createChildLogger("notify-msteams");

interface IncidentPayload {
  incidentId: string;
  ruleId: string;
  severity: string;
  status: string;
  message: string;
  createdAt: string;
}

const SEVERITY_COLOR: Record<string, string> = {
  CRITICAL: "attention",
  HIGH: "warning",
  MEDIUM: "accent",
  LOW: "good",
};

export async function sendMsTeamsMessage(webhookUrl: string, incident: IncidentPayload): Promise<void> {
  const payload = {
    type: "message",
    attachments: [
      {
        contentType: "application/vnd.microsoft.card.adaptive",
        content: {
          $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
          type: "AdaptiveCard",
          version: "1.4",
          body: [
            {
              type: "TextBlock",
              size: "medium",
              weight: "bolder",
              text: `${incident.severity} Alert`,
              color: SEVERITY_COLOR[incident.severity] ?? "default",
            },
            {
              type: "TextBlock",
              text: incident.message,
              wrap: true,
            },
            {
              type: "FactSet",
              facts: [
                { title: "Incident", value: incident.incidentId },
                { title: "Status", value: incident.status },
                { title: "Severity", value: incident.severity },
                { title: "Time", value: incident.createdAt },
              ],
            },
          ],
        },
      },
    ],
  };

  // SSRF guard: safeFetch re-validates at delivery time, connects to the
  // address it vetted and never follows a redirect.
  const res = await safeFetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    throw new ChannelHttpError(`MS Teams webhook failed: ${res.status}`, res.status, res.statusText);
  }

  log.debug({ webhookUrl, status: res.status }, "MS Teams message delivered");
}
