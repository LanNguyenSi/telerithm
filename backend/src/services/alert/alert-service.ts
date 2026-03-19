import type { AlertIncident, AlertRule } from "../../types/domain.js";
import { prisma } from "../../repositories/prisma.js";

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
}
