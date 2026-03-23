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
          <h2 className="text-lg font-semibold text-ink">Workspace</h2>
          <dl className="mt-4 space-y-2 text-sm">
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
          <h2 className="text-lg font-semibold text-ink">Log Sources</h2>
          {sources.length === 0 ? (
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
                <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
                <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
                <line x1="12" y1="22.08" x2="12" y2="12" />
              </svg>
              <p className="text-sm font-medium text-ink">No log sources configured</p>
              <p className="max-w-xs text-sm text-muted">
                Add a source to start ingesting logs from your services.
              </p>
            </div>
          ) : (
            <div className="mt-4 space-y-3">
              {sources.map((source) => (
                <article
                  key={source.id}
                  className="rounded-xl border border-line bg-white/70 p-3 dark:bg-white/5"
                >
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="text-sm font-medium text-ink">{source.name}</p>
                      <p className="mt-0.5 text-xs text-muted">{source.type}</p>
                    </div>
                    <span className="self-start rounded-full bg-cyan-100 px-3 py-1 font-mono text-xs text-cyan-800 dark:bg-cyan-900/30 dark:text-cyan-300 sm:self-auto">
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
