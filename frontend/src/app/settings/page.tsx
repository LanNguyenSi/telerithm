import { AppShell } from "@/components/dashboard/app-shell";
import { Card } from "@/components/ui/card";
import { getSources, getTeams, login } from "@/lib/api/client";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const auth = await login();
  const { teams } = await getTeams(auth.token);
  const team = teams[0];
  const { sources } = await getSources(team.id);

  return (
    <AppShell>
      <div className="grid gap-6 lg:grid-cols-[0.9fr_1.1fr]">
        <Card>
          <h2 className="text-xl font-semibold text-ink">Workspace</h2>
          <div className="mt-6 space-y-3 text-sm text-muted">
            <p>Name: <span className="font-medium text-ink">{team.name}</span></p>
            <p>Slug: <span className="font-mono text-ink">{team.slug}</span></p>
            <p>Plan: <span className="font-medium text-ink">{team.plan}</span></p>
          </div>
        </Card>
        <Card>
          <h2 className="text-xl font-semibold text-ink">Log Sources</h2>
          <div className="mt-6 space-y-4">
            {sources.map((source) => (
              <article key={source.id} className="rounded-2xl border border-line bg-white/70 p-4">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="font-medium text-ink">{source.name}</p>
                    <p className="mt-1 text-sm text-muted">{source.type}</p>
                  </div>
                  <span className="rounded-full bg-cyan-100 px-3 py-1 font-mono text-xs text-cyan-800">
                    {source.apiKey}
                  </span>
                </div>
              </article>
            ))}
          </div>
        </Card>
      </div>
    </AppShell>
  );
}
