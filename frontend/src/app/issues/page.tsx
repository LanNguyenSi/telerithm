import { AuthedShell } from "@/components/dashboard/authed-shell";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { getIssues } from "@/lib/api/client";
import { requireAuth } from "@/lib/auth/guard";
import { formatDate } from "@/lib/utils/format";
import type { Issue } from "@/types";

export const dynamic = "force-dynamic";

function statusTone(status: Issue["status"]) {
  if (status === "NEW") return "danger";
  if (status === "ONGOING") return "warning";
  if (status === "RESOLVED") return "signal";
  return "neutral";
}

function levelTone(level: string) {
  if (level === "error" || level === "fatal") return "danger";
  if (level === "warn") return "warning";
  return "neutral";
}

export default async function IssuesPage() {
  const { team } = await requireAuth();
  const { issues, total } = await getIssues(team.id);

  return (
    <AuthedShell>
      <Card>
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-semibold text-ink">Issues</h2>
          <span className="text-sm text-muted">{total} total</span>
        </div>

        <div className="mt-6 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-line text-xs uppercase tracking-wider text-muted">
                <th className="pb-3 pr-4">Status</th>
                <th className="pb-3 pr-4">Level</th>
                <th className="pb-3 pr-4">Title</th>
                <th className="pb-3 pr-4">Service</th>
                <th className="pb-3 pr-4 text-right">Events</th>
                <th className="pb-3 pr-4">First Seen</th>
                <th className="pb-3">Last Seen</th>
              </tr>
            </thead>
            <tbody>
              {issues.map((issue) => (
                <tr key={issue.id} className="border-b border-line/50 last:border-0">
                  <td className="py-3 pr-4">
                    <Badge tone={statusTone(issue.status)}>{issue.status}</Badge>
                  </td>
                  <td className="py-3 pr-4">
                    <Badge tone={levelTone(issue.level)}>{issue.level}</Badge>
                  </td>
                  <td className="max-w-md truncate py-3 pr-4 font-medium text-ink">
                    {issue.title}
                  </td>
                  <td className="py-3 pr-4 text-muted">{issue.service}</td>
                  <td className="py-3 pr-4 text-right font-mono tabular-nums">
                    {issue.eventCount.toLocaleString()}
                  </td>
                  <td className="py-3 pr-4 whitespace-nowrap text-muted">
                    {formatDate(issue.firstSeen)}
                  </td>
                  <td className="py-3 whitespace-nowrap text-muted">
                    {formatDate(issue.lastSeen)}
                  </td>
                </tr>
              ))}
              {issues.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-muted">
                    No issues found. Errors and fatal logs will appear here automatically.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </AuthedShell>
  );
}
