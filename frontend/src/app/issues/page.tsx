import type { Metadata } from "next";
import { AuthedShell } from "@/components/dashboard/authed-shell";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { getIssues } from "@/lib/api/client";
import { requireAuth } from "@/lib/auth/guard";
import { formatDate } from "@/lib/utils/format";
import type { Issue } from "@/types";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Issues" };

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

        {issues.length === 0 && (
          <div className="mt-8 flex flex-col items-center gap-3 py-10 text-center">
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
              <circle cx="12" cy="12" r="10" />
              <polyline points="16 12 12 8 8 12" />
              <line x1="12" y1="16" x2="12" y2="8" />
            </svg>
            <p className="font-medium text-ink">No issues found</p>
            <p className="max-w-sm text-sm text-muted">
              Errors and fatal logs will automatically create issues here.
            </p>
          </div>
        )}

        {/* Desktop table */}
        {issues.length > 0 && (
          <div className="mt-6 hidden overflow-x-auto md:block">
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
                    <td className="max-w-md truncate py-3 pr-4 font-medium text-ink">{issue.title}</td>
                    <td className="py-3 pr-4 text-muted">{issue.service}</td>
                    <td className="py-3 pr-4 text-right font-mono tabular-nums">
                      {issue.eventCount.toLocaleString()}
                    </td>
                    <td className="whitespace-nowrap py-3 pr-4 text-muted">{formatDate(issue.firstSeen)}</td>
                    <td className="whitespace-nowrap py-3 text-muted">{formatDate(issue.lastSeen)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Mobile cards */}
        {issues.length > 0 && (
          <div className="mt-4 space-y-3 md:hidden">
            {issues.map((issue) => (
              <article key={issue.id} className="rounded-2xl border border-line bg-white/70 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={statusTone(issue.status)}>{issue.status}</Badge>
                  <Badge tone={levelTone(issue.level)}>{issue.level}</Badge>
                  <span className="ml-auto font-mono text-xs text-muted">
                    {issue.eventCount.toLocaleString()} events
                  </span>
                </div>
                <p className="mt-2 font-medium text-ink">{issue.title}</p>
                <div className="mt-2 flex flex-wrap gap-3 text-xs text-muted">
                  <span>{issue.service}</span>
                  <span>First: {formatDate(issue.firstSeen)}</span>
                  <span>Last: {formatDate(issue.lastSeen)}</span>
                </div>
              </article>
            ))}
          </div>
        )}
      </Card>
    </AuthedShell>
  );
}
