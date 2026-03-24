import type { Metadata } from "next";
import { Card } from "@/components/ui/card";
import { getOverview } from "@/lib/api/client";
import { requireAuth } from "@/lib/auth/guard";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Dashboards" };

export default async function DashboardsPage() {
  const { team } = await requireAuth();
  const { overview } = await getOverview(team.id);

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card>
        <h2 className="text-lg font-semibold text-ink">Prebuilt Dashboard</h2>
        <p className="mt-2 text-xs text-muted">
          The MVP ships with an operational overview instead of a custom builder.
        </p>
        <div className="mt-4 space-y-2">
          {overview.services.map((item) => (
            <div
              key={item.service}
              className="flex items-center justify-between rounded-xl bg-white/70 px-3 py-2 dark:bg-white/5"
            >
              <span className="font-mono text-sm text-ink">{item.service}</span>
              <span className="font-mono text-xs text-muted">{item.count}</span>
            </div>
          ))}
        </div>
      </Card>
      <Card>
        <h2 className="text-lg font-semibold text-ink">Operational Summary</h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl bg-slate-950 p-4 text-white">
            <p className="text-xs uppercase tracking-[0.2em] text-cyan-200">Total Logs</p>
            <p className="mt-2 font-mono text-3xl font-semibold">{overview.totalLogs}</p>
          </div>
          <div className="rounded-xl bg-white/70 p-4 dark:bg-white/5">
            <p className="text-xs uppercase tracking-[0.2em] text-muted">Error Rate</p>
            <p className="mt-2 font-mono text-3xl font-semibold text-danger">{overview.errorRate}%</p>
          </div>
        </div>
      </Card>
    </div>
  );
}
