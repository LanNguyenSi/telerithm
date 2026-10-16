import type { AlertIncident, AlertRule } from "../../types/domain.js";
import type { z } from "zod";
import type { createAlertRuleSchema, updateAlertRuleSchema } from "../../validation/schemas.js";
import { prisma } from "../../repositories/prisma.js";
import { createChildLogger } from "../../logger.js";
import { ConflictError, NotFoundError } from "../../errors.js";

const log = createChildLogger("alert-service");

type IncidentStatus = "OPEN" | "ACKNOWLEDGED" | "RESOLVED";

// Which statuses each incident action may start from. Acknowledge and resolve
// act on live incidents; reopen takes a resolved or acknowledged one back to
// OPEN. Anything else (resolving a resolved incident, acknowledging a resolved
// one, reopening one that is already OPEN) is rejected with a ConflictError.
export const INCIDENT_TRANSITIONS = {
  acknowledge: ["OPEN"],
  resolve: ["OPEN", "ACKNOWLEDGED"],
  reopen: ["RESOLVED", "ACKNOWLEDGED"],
} as const satisfies Record<string, readonly IncidentStatus[]>;

export type CreateAlertRuleInput = z.infer<typeof createAlertRuleSchema>;
export type UpdateAlertRuleInput = z.infer<typeof updateAlertRuleSchema>;

type RuleRow = Awaited<ReturnType<typeof prisma.alertRule.findMany>>[number];

function toAlertRule(r: RuleRow): AlertRule {
  return {
    id: r.id,
    teamId: r.teamId,
    name: r.name,
    description: r.description ?? undefined,
    query: r.query,
    queryType: r.queryType === "SQL" ? ("sql" as const) : ("natural" as const),
    condition: r.condition,
    threshold: r.threshold,
    windowMinutes: r.windowMinutes,
    enabled: r.enabled,
    createdAt: r.createdAt.toISOString(),
  };
}

// P2025: no row matched the id and team (deleted meanwhile, or another team's).
function isRecordNotFound(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: unknown }).code === "P2025";
}

export class AlertService {
  async listRules(teamId: string): Promise<AlertRule[]> {
    const rules = await prisma.alertRule.findMany({ where: { teamId } });
    return rules.map(toAlertRule);
  }

  async createRule(teamId: string, input: CreateAlertRuleInput): Promise<AlertRule> {
    const rule = await prisma.alertRule.create({
      data: {
        teamId,
        name: input.name,
        description: input.description,
        query: input.query,
        condition: input.condition,
        threshold: input.threshold,
        windowMinutes: input.windowMinutes,
        enabled: input.enabled,
      },
    });
    log.info({ ruleId: rule.id, teamId }, "Alert rule created");
    return toAlertRule(rule);
  }

  // The where clause carries teamId next to the id, so a rule of another team
  // matches nothing (NotFoundError) even if the router's team check were
  // bypassed.
  async updateRule(ruleId: string, teamId: string, input: UpdateAlertRuleInput): Promise<AlertRule> {
    try {
      const rule = await prisma.alertRule.update({
        where: { id: ruleId, teamId },
        data: {
          name: input.name,
          description: input.description,
          query: input.query,
          condition: input.condition,
          threshold: input.threshold,
          windowMinutes: input.windowMinutes,
          enabled: input.enabled,
        },
      });
      log.info({ ruleId, teamId }, "Alert rule updated");
      return toAlertRule(rule);
    } catch (error) {
      if (isRecordNotFound(error)) throw new NotFoundError("Alert rule not found");
      throw error;
    }
  }

  // Hard delete; incidents and subscriptions of the rule cascade.
  async deleteRule(ruleId: string, teamId: string): Promise<void> {
    try {
      await prisma.alertRule.delete({ where: { id: ruleId, teamId } });
      log.info({ ruleId, teamId }, "Alert rule deleted");
    } catch (error) {
      if (isRecordNotFound(error)) throw new NotFoundError("Alert rule not found");
      throw error;
    }
  }

  async listIncidents(teamId: string): Promise<AlertIncident[]> {
    const incidents = await prisma.alertIncident.findMany({
      where: { rule: { teamId } },
      orderBy: { createdAt: "desc" },
      take: 20,
    });
    return incidents.map((i) => ({
      id: i.id,
      ruleId: i.ruleId,
      status: i.status as AlertIncident["status"],
      severity: i.severity as AlertIncident["severity"],
      message: i.message,
      createdAt: i.createdAt.toISOString(),
    }));
  }

  // teamId is a required scope on every incident mutation/read below: the
  // where clause must never match an incident outside the caller's
  // already-authorized team (defence in depth under the router's
  // requireTeamRole check; prisma.update can't carry a relation filter, so
  // the scope is asserted first). Returns the incident's current status for the
  // transition check.
  private async assertIncidentInTeam(incidentId: string, teamId: string): Promise<IncidentStatus> {
    const incident = await prisma.alertIncident.findFirst({
      where: { id: incidentId, rule: { teamId } },
      select: { id: true, status: true },
    });
    if (!incident) {
      throw new NotFoundError("Incident not found");
    }
    return incident.status as IncidentStatus;
  }

  // Moves an incident to `to` if its current status is one of `allowedFrom`,
  // otherwise throws a ConflictError and writes nothing. The update repeats the
  // status in its where clause, so an action that loses a race against another
  // one (the status changed after the read above) matches no row and is
  // reported as a conflict too, instead of overwriting the newer state.
  private async transitionIncident(
    action: string,
    incidentId: string,
    teamId: string,
    userId: string,
    comment: string | undefined,
    allowedFrom: readonly IncidentStatus[],
    to: IncidentStatus,
    eventAction: "ACKNOWLEDGED" | "RESOLVED" | "REOPENED",
  ) {
    const current = await this.assertIncidentInTeam(incidentId, teamId);
    if (!allowedFrom.includes(current)) {
      throw new ConflictError(
        `Cannot ${action} an incident that is ${current}; ${action} applies to ${allowedFrom.join(" or ")} incidents`,
      );
    }
    try {
      const [incident] = await prisma.$transaction([
        prisma.alertIncident.update({
          where: { id: incidentId, status: current, rule: { teamId } },
          data: { status: to },
        }),
        prisma.incidentEvent.create({
          data: { incidentId, userId, action: eventAction, comment },
        }),
      ]);
      return incident;
    } catch (error) {
      // P2025: no row matched the id, status and team any more.
      if (typeof error === "object" && error !== null && (error as { code?: unknown }).code === "P2025") {
        throw new ConflictError("Incident status changed concurrently; reload the incident and retry");
      }
      throw error;
    }
  }

  async acknowledgeIncident(incidentId: string, teamId: string, userId: string, comment?: string) {
    const incident = await this.transitionIncident(
      "acknowledge",
      incidentId,
      teamId,
      userId,
      comment,
      INCIDENT_TRANSITIONS.acknowledge,
      "ACKNOWLEDGED",
      "ACKNOWLEDGED",
    );
    log.info({ incidentId, teamId, userId }, "Incident acknowledged");
    return incident;
  }

  async resolveIncident(incidentId: string, teamId: string, userId: string, comment?: string) {
    const incident = await this.transitionIncident(
      "resolve",
      incidentId,
      teamId,
      userId,
      comment,
      INCIDENT_TRANSITIONS.resolve,
      "RESOLVED",
      "RESOLVED",
    );
    log.info({ incidentId, teamId, userId }, "Incident resolved");
    return incident;
  }

  async reopenIncident(incidentId: string, teamId: string, userId: string, comment?: string) {
    const incident = await this.transitionIncident(
      "reopen",
      incidentId,
      teamId,
      userId,
      comment,
      INCIDENT_TRANSITIONS.reopen,
      "OPEN",
      "REOPENED",
    );
    log.info({ incidentId, teamId, userId }, "Incident reopened");
    return incident;
  }

  async getIncidentTimeline(incidentId: string, teamId: string) {
    return prisma.incidentEvent.findMany({
      where: { incidentId, incident: { rule: { teamId } } },
      include: { user: { select: { id: true, name: true, email: true } } },
      orderBy: { createdAt: "asc" },
    });
  }
}
