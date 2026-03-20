import { AuthedShell } from "@/components/dashboard/authed-shell";
import { Card } from "@/components/ui/card";
import { getOverview } from "@/lib/api/client";
import { requireAuth } from "@/lib/auth/guard";

export const dynamic = "force-dynamic";

export default async function DashboardsPage() {
  const { team } = await requireAuth();
  const { overview } = await getOverview(team.id);

  return (
    <AuthedShell>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <h2 className="text-xl font-semibold text-ink">Prebuilt Dashboard</h2>
          <p className="mt-3 text-sm text-muted">
            The MVP ships with an operational overview instead of a custom builder.
          </p>
          <div className="mt-6 space-y-4">
            {overview.services.map((item) => (
              <div key={item.service} className="flex items-center justify-between rounded-2xl bg-white/70 px-4 py-3">
                <span className="font-medium text-ink">{item.service}</span>
                <span className="font-mono text-sm text-muted">{item.count}</span>
              </div>
            ))}
          </div>
        </Card>
        <Card>
          <h2 className="text-xl font-semibold text-ink">Operational Summary</h2>
          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            <div className="rounded-2xl bg-slate-950 p-5 text-white">
              <p className="text-sm uppercase tracking-[0.24em] text-cyan-200">Total Logs</p>
              <p className="mt-3 text-4xl font-semibold">{overview.totalLogs}</p>
            </div>
            <div className="rounded-2xl bg-white/70 p-5">
              <p className="text-sm uppercase tracking-[0.24em] text-muted">Error Rate</p>
              <p className="mt-3 text-4xl font-semibold text-danger">{overview.errorRate}%</p>
            </div>
          </div>
        </Card>
      </div>
    </AuthedShell>
  );
}
