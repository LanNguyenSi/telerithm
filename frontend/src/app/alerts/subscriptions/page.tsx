import { AuthedShell } from "@/components/dashboard/authed-shell";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { getAlertRules, getSubscriptions } from "@/lib/api/client";
import { requireAuth } from "@/lib/auth/guard";
import { formatDate } from "@/lib/utils/format";

export const dynamic = "force-dynamic";

function channelTone(channel: string) {
  if (channel === "SLACK") return "signal";
  if (channel === "EMAIL") return "neutral";
  if (channel === "WEBHOOK") return "warning";
  return "neutral";
}

export default async function SubscriptionsPage() {
  const { token, team } = await requireAuth();
  const [{ subscriptions }, { rules }] = await Promise.all([
    getSubscriptions(team.id, token),
    getAlertRules(team.id),
  ]);

  return (
    <AuthedShell>
      <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
        <Card>
          <h2 className="text-xl font-semibold text-ink">My Subscriptions</h2>
          <div className="mt-6 space-y-4">
            {subscriptions.map((sub) => (
              <article
                key={sub.id}
                className="flex items-start justify-between rounded-2xl border border-line bg-white/70 p-4"
              >
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={channelTone(sub.channel)}>{sub.channel}</Badge>
                    {sub.severities.length > 0 ? (
                      sub.severities.map((s) => (
                        <Badge key={s} tone="neutral">
                          {s}
                        </Badge>
                      ))
                    ) : (
                      <Badge tone="neutral">ALL SEVERITIES</Badge>
                    )}
                    {!sub.enabled && <Badge tone="neutral">DISABLED</Badge>}
                  </div>
                  <p className="mt-2 text-sm font-medium text-ink">
                    {sub.rule ? `Rule: ${sub.rule.name}` : "All rules in team"}
                  </p>
                  <p className="mt-1 text-xs text-muted">Created {formatDate(sub.createdAt)}</p>
                </div>
              </article>
            ))}
            {subscriptions.length === 0 && (
              <p className="py-8 text-center text-muted">
                No subscriptions yet. Create one to get notified about incidents.
              </p>
            )}
          </div>
        </Card>

        <Card>
          <h2 className="text-xl font-semibold text-ink">Available Rules</h2>
          <p className="mt-2 text-sm text-muted">Subscribe to specific rules or to all rules in your team.</p>
          <div className="mt-6 space-y-3">
            {rules.map((rule) => (
              <article
                key={rule.id}
                className="rounded-2xl border border-line bg-white/70 p-4 dark:bg-white/5"
              >
                <p className="font-medium text-ink">{rule.name}</p>
                <p className="mt-1 text-sm text-muted">{rule.description ?? "No description"}</p>
                <p className="mt-2 text-xs text-muted">Threshold: {rule.threshold}</p>
              </article>
            ))}
            {rules.length === 0 && (
              <p className="py-4 text-center text-sm text-muted">No alert rules configured yet.</p>
            )}
          </div>
        </Card>
      </div>
    </AuthedShell>
  );
}
