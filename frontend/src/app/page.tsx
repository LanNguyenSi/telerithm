import { AuthedShell } from "@/components/dashboard/authed-shell";
import { IncidentList } from "@/components/alerts/incident-list";
import { MetricCard } from "@/components/dashboard/metric-card";
import { ServiceList } from "@/components/dashboard/service-list";
import { getOverview } from "@/lib/api/client";
import { requireAuth } from "@/lib/auth/guard";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const { team } = await requireAuth();
  const { overview } = await getOverview(team.id);

  return (
    <AuthedShell>
      <section className="grid gap-6 lg:grid-cols-3">
        <MetricCard
          label="Total Logs"
          value={overview.totalLogs.toLocaleString("de-DE")}
          hint="In-memory MVP feed across the demo workspace."
        />
        <MetricCard
          label="Error Rate"
          value={`${overview.errorRate}%`}
          hint="Ratio of error and fatal events in the sampled window."
        />
        <MetricCard
          label="Workspace"
          value={team.name}
          hint={`Slug: ${team.slug}`}
        />
      </section>
      <section className="mt-6 grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
        <ServiceList services={overview.services} />
        <IncidentList incidents={overview.recentIncidents} />
      </section>
    </AuthedShell>
  );
}
