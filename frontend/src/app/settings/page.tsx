import type { Metadata } from "next";
import { AuthedShell } from "@/components/dashboard/authed-shell";
import { Card } from "@/components/ui/card";
import { getSources } from "@/lib/api/client";
import { requireAuth } from "@/lib/auth/guard";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  const { team } = await requireAuth();
  const { sources } = await getSources(team.id);

  return (
    <AuthedShell>
      <div className="grid gap-4 lg:grid-cols-[0.9fr_1.1fr] lg:gap-6">
        <Card>
          <h2 className="text-xl font-semibold text-ink">Workspace</h2>
          <dl className="mt-6 space-y-3 text-sm">
            <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
              <dt className="text-muted">Name</dt>
              <dd className="font-medium text-ink">{team.name}</dd>
            </div>
            <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
              <dt className="text-muted">Slug</dt>
              <dd className="font-mono text-ink">{team.slug}</dd>
            </div>
          </dl>
        </Card>
        <Card>
          <h2 className="text-xl font-semibold text-ink">Log Sources</h2>
          {sources.length === 0 ? (
            <p className="mt-4 text-sm text-muted">
              No log sources configured. Add a source to start ingesting logs.
            </p>
          ) : (
            <div className="mt-6 space-y-4">
              {sources.map((source) => (
                <article key={source.id} className="rounded-2xl border border-line bg-white/70 p-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="font-medium text-ink">{source.name}</p>
                      <p className="mt-1 text-sm text-muted">{source.type}</p>
                    </div>
                    <span className="self-start rounded-full bg-cyan-100 px-3 py-1 font-mono text-xs text-cyan-800 sm:self-auto">
                      {source.apiKey}
                    </span>
                  </div>
                </article>
              ))}
            </div>
          )}
        </Card>
      </div>
    </AuthedShell>
  );
}
