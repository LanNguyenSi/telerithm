import { SubscriptionService } from "../subscription/subscription-service.js";
import { sendWebhook } from "./channels/webhook.js";
import { sendEmail } from "./channels/email.js";
import { sendMsTeamsMessage } from "./channels/msteams.js";
import { createChildLogger } from "../../logger.js";

const log = createChildLogger("notification-dispatcher");
const MAX_RETRIES = 3;

interface IncidentInfo {
  id: string;
  ruleId: string;
  teamId: string;
  severity: string;
  status: string;
  message: string;
  createdAt: string;
}

export class NotificationDispatcher {
  private readonly subscriptionService = new SubscriptionService();

  async dispatch(incident: IncidentInfo): Promise<void> {
    const subscribers = await this.subscriptionService.findForIncident(
      incident.ruleId,
      incident.teamId,
      incident.severity,
    );

    if (subscribers.length === 0) {
      log.debug({ incidentId: incident.id }, "No subscribers for incident");
      return;
    }

    log.info({ incidentId: incident.id, subscriberCount: subscribers.length }, "Dispatching notifications");

    const tasks = subscribers.map(
      (sub: {
        id: string;
        channel: string;
        config: unknown;
        user: { id: string; email: string; name: string };
      }) =>
        this.sendWithRetry(sub, incident).catch((err) => {
          log.error(
            { err, subscriptionId: sub.id, channel: sub.channel },
            "Notification failed after retries",
          );
        }),
    );

    await Promise.allSettled(tasks);
  }

  private async sendWithRetry(
    subscription: {
      id: string;
      channel: string;
      config: unknown;
      user: { id: string; email: string; name: string };
    },
    incident: IncidentInfo,
  ): Promise<void> {
    const config = subscription.config as Record<string, string>;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        switch (subscription.channel) {
          case "WEBHOOK": {
            const url = config.url;
            if (!url) throw new Error("Webhook URL not configured");
            await sendWebhook(
              url,
              {
                incidentId: incident.id,
                ruleId: incident.ruleId,
                severity: incident.severity,
                status: incident.status,
                message: incident.message,
                createdAt: incident.createdAt,
              },
              { secret: config.secret },
            );
            break;
          }
          case "EMAIL": {
            await sendEmail({
              to: config.email ?? subscription.user.email,
              subject: `[Telerithm] ${incident.severity} Alert: ${incident.message.slice(0, 80)}`,
              body: [
                `Incident: ${incident.id}`,
                `Severity: ${incident.severity}`,
                `Status: ${incident.status}`,
                `Message: ${incident.message}`,
                `Time: ${incident.createdAt}`,
              ].join("\n"),
            });
            break;
          }
          case "SLACK": {
            const webhookUrl = config.webhook_url;
            if (!webhookUrl) throw new Error("Slack webhook URL not configured");
            await sendSlackMessage(webhookUrl, incident);
            break;
          }
          case "MSTEAMS": {
            const teamsUrl = config.webhook_url;
            if (!teamsUrl) throw new Error("MS Teams webhook URL not configured");
            await sendMsTeamsMessage(teamsUrl, {
              incidentId: incident.id,
              ruleId: incident.ruleId,
              severity: incident.severity,
              status: incident.status,
              message: incident.message,
              createdAt: incident.createdAt,
            });
            break;
          }
          default:
            log.warn({ channel: subscription.channel }, "Unsupported notification channel");
            return;
        }
        // Success
        return;
      } catch (err) {
        if (attempt === MAX_RETRIES) throw err;
        const delay = Math.pow(2, attempt) * 500;
        log.warn(
          { attempt, delay, subscriptionId: subscription.id },
          "Notification attempt failed, retrying",
        );
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }
}

async function sendSlackMessage(webhookUrl: string, incident: IncidentInfo): Promise<void> {
  const severityEmoji: Record<string, string> = {
    CRITICAL: ":red_circle:",
    HIGH: ":large_orange_circle:",
    MEDIUM: ":large_yellow_circle:",
    LOW: ":large_blue_circle:",
  };

  const payload = {
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `${severityEmoji[incident.severity] ?? ":warning:"} *${incident.severity} Alert*\n${incident.message}`,
        },
      },
      {
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: `Incident \`${incident.id}\` | Status: *${incident.status}* | ${incident.createdAt}`,
          },
        ],
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
    throw new Error(`Slack webhook failed: ${res.status}`);
  }
}
