import type { AlertIncident, AlertRule } from "../../types/domain.js";
import { store } from "../../repositories/in-memory-store.js";

export class AlertService {
  listRules(teamId: string): AlertRule[] {
    return store.alertRules.filter((rule) => rule.teamId === teamId);
  }

  listIncidents(teamId: string): AlertIncident[] {
    const ruleIds = new Set(this.listRules(teamId).map((rule) => rule.id));
    return store.incidents.filter((incident) => ruleIds.has(incident.ruleId));
  }
}

