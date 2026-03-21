import type { Metadata } from "next";
import Link from "next/link";
import { AuthedShell } from "@/components/dashboard/authed-shell";
import { IncidentList } from "@/components/alerts/incident-list";
import { Card } from "@/components/ui/card";
import { getAlertIncidents, getAlertRules } from "@/lib/api/client";
import { requireAuth } from "@/lib/auth/guard";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Alerts" };

export default async function AlertsPage() {
  const { team } = await requireAuth();
  const [{ incidents }, { rules }] = await Promise.all([getAlertIncidents(team.id), getAlertRules(team.id)]);

  return (
    <AuthedShell>
      <div className="mb-4 flex items-center justify-between lg:mb-6">
        <h2 className="text-xl font-semibold text-ink sm:text-2xl">Alerts</h2>
        <Link
          href="/alerts/subscriptions"
          className="rounded-full border border-line bg-white/80 px-4 py-2 text-sm text-ink transition hover:border-slate-400"
        >
          Subscriptions
        </Link>
      </div>
      <section className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr] lg:gap-6">
        <IncidentList incidents={incidents} />
        <Card>
          <h2 className="text-xl font-semibold text-ink">Alert Rules</h2>
          {rules.length === 0 ? (
            <p className="mt-4 text-sm text-muted">No alert rules configured yet.</p>
          ) : (
            <div className="mt-6 space-y-4">
              {rules.map((rule) => (
                <article key={rule.id} className="rounded-2xl border border-line bg-white/70 p-4">
                  <p className="font-medium text-ink">{rule.name}</p>
                  <p className="mt-2 text-sm text-muted">{rule.description ?? "No description"}</p>
                  <p className="mt-3 text-sm text-muted">Threshold: {rule.threshold}</p>
                </article>
              ))}
            </div>
          )}
        </Card>
      </section>
    </AuthedShell>
  );
}
