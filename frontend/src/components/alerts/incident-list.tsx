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
      {incidents.length === 0 ? (
        <div className="mt-6 flex flex-col items-center gap-3 rounded-2xl border border-dashed border-line bg-white/50 p-8 text-center dark:bg-white/5">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="36"
            height="36"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="text-signal"
          >
            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
            <polyline points="22 4 12 14.01 9 11.01" />
          </svg>
          <p className="text-base font-medium text-ink">No open incidents</p>
          <p className="mt-1 max-w-xs text-sm text-muted">
            Triggered alerts will appear here with severity and timeline context.
          </p>
        </div>
      ) : (
        <div className="mt-6 space-y-4">
          {incidents.map((incident) => (
            <article
              key={incident.id}
              className="rounded-2xl border border-line bg-white/70 p-4 dark:bg-white/5"
            >
              <div className="flex flex-wrap items-center gap-3">
                <Badge tone={severityTone(incident.severity)}>{incident.severity}</Badge>
                <Badge>{incident.status}</Badge>
              </div>
              <p className="mt-3 text-base font-medium text-ink">{incident.message}</p>
              <p className="mt-2 text-sm text-muted">{formatDate(incident.createdAt)}</p>
            </article>
          ))}
        </div>
      )}
    </Card>
  );
}
