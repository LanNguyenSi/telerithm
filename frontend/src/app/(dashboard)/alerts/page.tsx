import type { Metadata } from "next";
import Link from "next/link";
import { AlertRulesPanel } from "@/components/alerts/alert-rules-panel";
import { IncidentList } from "@/components/alerts/incident-list";
import { getAlertIncidents, getAlertRules } from "@/lib/api/client";
import { requireAuth } from "@/lib/auth/guard";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Alerts" };

export default async function AlertsPage() {
  const { team, token } = await requireAuth();
  const [{ incidents }, { rules }] = await Promise.all([
    getAlertIncidents(team.id, token),
    getAlertRules(team.id, token),
  ]);

  return (
    <>
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
        <AlertRulesPanel rules={rules} teamId={team.id} token={token} role={team.role} />
      </section>
    </>
  );
}
