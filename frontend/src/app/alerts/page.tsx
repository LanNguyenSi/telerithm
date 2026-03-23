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
        <h2 className="text-lg font-semibold text-ink sm:text-xl">Alerts</h2>
        <Link
          href="/alerts/subscriptions"
          className="rounded-lg border border-line bg-white/80 px-3 py-1.5 text-sm text-ink transition hover:border-slate-400 dark:bg-white/5"
        >
          Subscriptions
        </Link>
      </div>
      <section className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr] lg:gap-6">
        <IncidentList incidents={incidents} />
        <Card>
          <h2 className="text-lg font-semibold text-ink">Alert Rules</h2>
          {rules.length === 0 ? (
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
                className="text-muted"
              >
                <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                <path d="M13.73 21a2 2 0 0 1-3.46 0" />
              </svg>
              <p className="text-sm font-medium text-ink">No alert rules configured</p>
              <p className="max-w-xs text-sm text-muted">
                Create rules to get notified when log patterns exceed thresholds.
              </p>
            </div>
          ) : (
            <div className="mt-4 space-y-3">
              {rules.map((rule) => (
                <article
                  key={rule.id}
                  className="rounded-xl border border-line bg-white/70 p-3 dark:bg-white/5"
                >
                  <p className="text-sm font-medium text-ink">{rule.name}</p>
                  <p className="mt-1 text-xs text-muted">{rule.description ?? "No description"}</p>
                  <p className="mt-1.5 font-mono text-xs text-muted">Threshold: {rule.threshold}</p>
                </article>
              ))}
            </div>
          )}
        </Card>
      </section>
    </AuthedShell>
  );
}
