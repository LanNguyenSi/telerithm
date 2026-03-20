import Link from "next/link";
import { AppShell } from "@/components/dashboard/app-shell";
import { IncidentList } from "@/components/alerts/incident-list";
import { Card } from "@/components/ui/card";
import { getAlertIncidents, getAlertRules, getTeams, login } from "@/lib/api/client";

export const dynamic = "force-dynamic";

export default async function AlertsPage() {
  const auth = await login();
  const { teams } = await getTeams(auth.token);
  const team = teams[0];
  const [{ incidents }, { rules }] = await Promise.all([
    getAlertIncidents(team.id),
    getAlertRules(team.id),
  ]);

  return (
    <AppShell>
      <div className="mb-6 flex items-center justify-between">
        <h2 className="text-2xl font-semibold text-ink">Alerts</h2>
        <Link
          href="/alerts/subscriptions"
          className="rounded-full border border-line bg-white/80 px-4 py-2 text-sm text-ink transition hover:border-slate-400"
        >
          Manage Subscriptions
        </Link>
      </div>
      <section className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
        <IncidentList incidents={incidents} />
        <Card>
          <h2 className="text-xl font-semibold text-ink">Alert Rules</h2>
          <div className="mt-6 space-y-4">
            {rules.map((rule) => (
              <article key={rule.id} className="rounded-2xl border border-line bg-white/70 p-4">
                <p className="font-medium text-ink">{rule.name}</p>
                <p className="mt-2 text-sm text-muted">{rule.description ?? "No description"}</p>
                <p className="mt-3 text-sm text-muted">Threshold: {rule.threshold}</p>
              </article>
            ))}
          </div>
        </Card>
      </section>
    </AppShell>
  );
}
