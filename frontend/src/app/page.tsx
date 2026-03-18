import { AppShell } from "@/components/dashboard/app-shell";
import { IncidentList } from "@/components/alerts/incident-list";
import { MetricCard } from "@/components/dashboard/metric-card";
import { ServiceList } from "@/components/dashboard/service-list";
import { login, getOverview, getTeams } from "@/lib/api/client";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const auth = await login();
  const { teams } = await getTeams(auth.token);
  const team = teams[0];
  const { overview } = await getOverview(team.id);

  return (
    <AppShell>
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
          label="Plan"
          value={team.plan}
          hint="Current workspace tier from the demo tenancy layer."
        />
      </section>
      <section className="mt-6 grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
        <ServiceList services={overview.services} />
        <IncidentList incidents={overview.recentIncidents} />
      </section>
    </AppShell>
  );
}
