import { prisma } from "../../repositories/prisma.js";
import { clickhouse } from "../../repositories/clickhouse.js";
import { createChildLogger } from "../../logger.js";
import { alertEvaluationsTotal, alertIncidentsCreatedTotal } from "../../metrics/index.js";
import { NotificationDispatcher } from "../notification/notification-dispatcher.js";

const log = createChildLogger("alert-eval");

// ClickHouse parses a DateTime64 query parameter strictly: the ISO "T" and "Z"
// of Date.toISOString() make it reject the value, so send "YYYY-MM-DD HH:MM:SS.mmm"
// in UTC, the same shape LogRepository uses.
function toClickHouseTimestamp(date: Date): string {
  return date.toISOString().replace("T", " ").replace("Z", "");
}

export class AlertEvaluationWorker {
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private readonly dispatcher = new NotificationDispatcher();
  // Rules already reported as unsupported, so the warning is logged once per
  // process instead of on every evaluation loop.
  private readonly warnedUnsupported = new Set<string>();

  constructor(private readonly intervalMs = 60_000) {}

  start(): void {
    if (this.timer) return;
    log.info({ intervalMs: this.intervalMs }, "Alert evaluation worker started");
    this.timer = setInterval(() => this.evaluate(), this.intervalMs);
    // Run first evaluation immediately
    this.evaluate();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      log.info("Alert evaluation worker stopped");
    }
  }

  private async evaluate(): Promise<void> {
    if (this.running) return;
    this.running = true;

    try {
      const rules = await prisma.alertRule.findMany({ where: { enabled: true } });
      log.debug({ ruleCount: rules.length }, "Evaluating alert rules");

      for (const rule of rules) {
        try {
          await this.evaluateRule(rule);
          alertEvaluationsTotal.inc({ status: "ok" });
        } catch (err) {
          alertEvaluationsTotal.inc({ status: "error" });
          log.error({ err, ruleId: rule.id }, "Failed to evaluate rule");
        }
      }
    } catch (err) {
      log.error({ err }, "Failed to load alert rules");
    } finally {
      this.running = false;
    }
  }

  private async evaluateRule(rule: {
    id: string;
    teamId: string;
    query: string;
    condition: string;
    threshold: number;
    windowMinutes: number;
    muteUntil: Date | null;
  }): Promise<void> {
    // ANOMALY_DETECTED is a reserved AlertCondition value: no detector exists,
    // so the rule could never trigger. Skip it before any lookup and say so,
    // rather than letting it look like a rule whose threshold is never reached.
    if (rule.condition === "ANOMALY_DETECTED") {
      if (!this.warnedUnsupported.has(rule.id)) {
        this.warnedUnsupported.add(rule.id);
        log.warn(
          { ruleId: rule.id, condition: rule.condition },
          "Alert condition ANOMALY_DETECTED is not supported, rule is skipped",
        );
      }
      return;
    }

    // Skip muted rules
    if (rule.muteUntil && rule.muteUntil > new Date()) {
      log.debug({ ruleId: rule.id, muteUntil: rule.muteUntil }, "Rule is muted, skipping");
      return;
    }

    // Skip if team is in a maintenance window
    const activeWindow = await prisma.maintenanceWindow.findFirst({
      where: {
        teamId: rule.teamId,
        startsAt: { lte: new Date() },
        endsAt: { gte: new Date() },
      },
    });
    if (activeWindow) {
      log.debug({ ruleId: rule.id, windowId: activeWindow.id }, "Team in maintenance window, skipping");
      return;
    }

    // Check for existing open incident (deduplication)
    const openIncident = await prisma.alertIncident.findFirst({
      where: { ruleId: rule.id, status: "OPEN" },
    });
    if (openIncident) return;

    const now = new Date();
    const windowStart = new Date(now.getTime() - rule.windowMinutes * 60_000);

    const currentCount = await this.queryLogCount(rule.teamId, rule.query, windowStart, now);

    let triggered = false;

    switch (rule.condition) {
      case "GREATER_THAN":
        triggered = currentCount > rule.threshold;
        break;
      case "LESS_THAN":
        triggered = currentCount < rule.threshold;
        break;
      case "EQUALS":
        triggered = currentCount === rule.threshold;
        break;
      case "CHANGES_BY": {
        const prevStart = new Date(windowStart.getTime() - rule.windowMinutes * 60_000);
        const prevCount = await this.queryLogCount(rule.teamId, rule.query, prevStart, windowStart);
        const delta = Math.abs(currentCount - prevCount);
        triggered = delta >= rule.threshold;
        break;
      }
      default:
        break;
    }

    if (triggered) {
      const incident = await prisma.alertIncident.create({
        data: {
          ruleId: rule.id,
          status: "OPEN",
          severity: "MEDIUM",
          message: `Alert "${rule.query}" triggered: count=${currentCount}, threshold=${rule.threshold}, condition=${rule.condition}`,
        },
      });
      alertIncidentsCreatedTotal.inc();
      log.warn({ ruleId: rule.id, currentCount, threshold: rule.threshold }, "Alert incident created");

      // Fire-and-forget: notify subscribers
      this.dispatcher
        .dispatch({
          id: incident.id,
          ruleId: rule.id,
          teamId: rule.teamId,
          severity: incident.severity,
          status: incident.status,
          message: incident.message,
          createdAt: incident.createdAt.toISOString(),
        })
        .catch((err) => log.error({ err, incidentId: incident.id }, "Notification dispatch failed"));
    }
  }

  private async queryLogCount(teamId: string, query: string, from: Date, to: Date): Promise<number> {
    // The rule.query is a plain substring: it is bound as the ILIKE pattern
    // `%<query>%` and matched case-insensitively against the log message. It is
    // not SQL and not a WHERE fragment, and `%` and `_` inside it act as ILIKE
    // wildcards.
    const result = await clickhouse.query({
      query: `SELECT count() as cnt FROM logs WHERE team_id = {teamId:String} AND timestamp >= {from:DateTime64(3)} AND timestamp <= {to:DateTime64(3)} AND message ILIKE {pattern:String}`,
      query_params: {
        teamId,
        from: toClickHouseTimestamp(from),
        to: toClickHouseTimestamp(to),
        pattern: `%${query}%`,
      },
      format: "JSONEachRow",
    });

    const rows = (await result.json()) as Array<{ cnt: string }>;
    return rows.length > 0 ? Number(rows[0].cnt) : 0;
  }
}
