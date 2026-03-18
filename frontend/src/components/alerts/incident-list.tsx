import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { formatDate } from "@/lib/utils/format";
import type { AlertIncident } from "@/types";

function severityTone(severity: AlertIncident["severity"]) {
  if (severity === "CRITICAL" || severity === "HIGH") {
    return "danger";
  }
  if (severity === "MEDIUM") {
    return "warning";
  }
  return "signal";
}

export function IncidentList({ incidents }: { incidents: AlertIncident[] }) {
  return (
    <Card>
      <h2 className="text-xl font-semibold text-ink">Active Incidents</h2>
      <div className="mt-6 space-y-4">
        {incidents.map((incident) => (
          <article key={incident.id} className="rounded-2xl border border-line bg-white/70 p-4">
            <div className="flex flex-wrap items-center gap-3">
              <Badge tone={severityTone(incident.severity)}>{incident.severity}</Badge>
              <Badge>{incident.status}</Badge>
            </div>
            <p className="mt-3 text-base font-medium text-ink">{incident.message}</p>
            <p className="mt-2 text-sm text-muted">{formatDate(incident.createdAt)}</p>
          </article>
        ))}
      </div>
    </Card>
  );
}

