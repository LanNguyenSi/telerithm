import type { AlertIncident, AlertRule } from "../../types/domain.js";
import { prisma } from "../../repositories/prisma.js";
import { createChildLogger } from "../../logger.js";

const log = createChildLogger("alert-service");

export class AlertService {
  async listRules(teamId: string): Promise<AlertRule[]> {
    const rules = await prisma.alertRule.findMany({ where: { teamId } });
    return rules.map((r) => ({
      id: r.id,
      teamId: r.teamId,
      name: r.name,
      description: r.description ?? undefined,
      query: r.query,
      queryType: r.queryType === "SQL" ? ("sql" as const) : ("natural" as const),
      threshold: r.threshold,
      enabled: r.enabled,
      createdAt: r.createdAt.toISOString(),
    }));
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
  // the scope is asserted first).
  private async assertIncidentInTeam(incidentId: string, teamId: string): Promise<void> {
    const incident = await prisma.alertIncident.findFirst({
      where: { id: incidentId, rule: { teamId } },
      select: { id: true },
    });
    if (!incident) {
      throw new Error("Incident not found");
    }
  }

  async acknowledgeIncident(incidentId: string, teamId: string, userId: string, comment?: string) {
    await this.assertIncidentInTeam(incidentId, teamId);
    const [incident] = await prisma.$transaction([
      prisma.alertIncident.update({
        where: { id: incidentId, rule: { teamId } },
        data: { status: "ACKNOWLEDGED" },
      }),
      prisma.incidentEvent.create({
        data: { incidentId, userId, action: "ACKNOWLEDGED", comment },
      }),
    ]);
    log.info({ incidentId, teamId, userId }, "Incident acknowledged");
    return incident;
  }

  async resolveIncident(incidentId: string, teamId: string, userId: string, comment?: string) {
    await this.assertIncidentInTeam(incidentId, teamId);
    const [incident] = await prisma.$transaction([
      prisma.alertIncident.update({
        where: { id: incidentId, rule: { teamId } },
        data: { status: "RESOLVED" },
      }),
      prisma.incidentEvent.create({
        data: { incidentId, userId, action: "RESOLVED", comment },
      }),
    ]);
    log.info({ incidentId, teamId, userId }, "Incident resolved");
    return incident;
  }

  async reopenIncident(incidentId: string, teamId: string, userId: string, comment?: string) {
    await this.assertIncidentInTeam(incidentId, teamId);
    const [incident] = await prisma.$transaction([
      prisma.alertIncident.update({
        where: { id: incidentId, rule: { teamId } },
        data: { status: "OPEN" },
      }),
      prisma.incidentEvent.create({
        data: { incidentId, userId, action: "REOPENED", comment },
      }),
    ]);
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
