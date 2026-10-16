import type { Metadata } from "next";
import { SourcesPanel } from "@/components/settings/sources-panel";
import { ThemeSwitch } from "@/components/settings/theme-switch";
import { Card } from "@/components/ui/card";
import { getSources } from "@/lib/api/client";
import { requireAuth } from "@/lib/auth/guard";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  const { team, token } = await requireAuth();
  const { sources } = await getSources(team.id, token);

  return (
    <div className="space-y-4 lg:space-y-6">
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
      <SourcesPanel sources={sources} teamId={team.id} token={token} role={team.role} />
      </div>
      <Card>
        <h2 className="text-lg font-semibold text-ink">Appearance</h2>
        <p className="mt-1 text-xs text-muted">Choose your preferred color theme.</p>
        <div className="mt-4">
          <ThemeSwitch />
        </div>
      </Card>
    </div>
  );
}
