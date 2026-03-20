import { createChildLogger } from "../../../logger.js";

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

  const res = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(10_000),
  });

  if (!res.ok) {
    throw new Error(`MS Teams webhook failed: ${res.status}`);
  }

  log.debug({ webhookUrl, status: res.status }, "MS Teams message delivered");
}
