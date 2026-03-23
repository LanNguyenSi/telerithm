"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { PaginationControls } from "@/components/ui/pagination-controls";
import { SkeletonTable } from "@/components/ui/skeleton";
import { getIssues } from "@/lib/api/client";
import { formatDate } from "@/lib/utils/format";
import type { Issue, Team } from "@/types";

const DEFAULT_PAGE_SIZE = 50;
const ALLOWED_PAGE_SIZES = [25, 50, 100];
const DEFAULT_SORT = { sortBy: "lastSeen" as const, sortDirection: "desc" as const };

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

export function IssueExplorer({ team }: { team: Team }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [issues, setIssues] = useState<Issue[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const currentPage = Math.max(1, Number.parseInt(searchParams.get("page") ?? "1", 10) || 1);
  const rawPageSize =
    Number.parseInt(searchParams.get("pageSize") ?? `${DEFAULT_PAGE_SIZE}`, 10) || DEFAULT_PAGE_SIZE;
  const pageSize = ALLOWED_PAGE_SIZES.includes(rawPageSize) ? rawPageSize : DEFAULT_PAGE_SIZE;
  const currentFilters = {
    query: searchParams.get("q") ?? "",
    status: searchParams.get("status") ?? "",
    service: searchParams.get("service") ?? "",
    level: searchParams.get("level") ?? "",
  };
  const currentSort = {
    sortBy:
      (searchParams.get("sortBy") as
        | "lastSeen"
        | "firstSeen"
        | "eventCount"
        | "service"
        | "level"
        | "status"
        | null) ?? DEFAULT_SORT.sortBy,
    sortDirection: (searchParams.get("sortDirection") as "asc" | "desc" | null) ?? DEFAULT_SORT.sortDirection,
  };

  useEffect(() => {
    let active = true;

    async function loadIssues() {
      setLoading(true);
      setError(null);

      try {
        const offset = (currentPage - 1) * pageSize;
        const result = await getIssues(team.id, {
          query: currentFilters.query || undefined,
          status: currentFilters.status || undefined,
          service: currentFilters.service || undefined,
          level: currentFilters.level || undefined,
          sortBy: currentSort.sortBy,
          sortDirection: currentSort.sortDirection,
          limit: pageSize,
          offset,
        });

        if (!active) return;

        setIssues(result.issues);
        setTotal(result.total);
      } catch (loadError) {
        if (active) {
          setError(loadError instanceof Error ? loadError.message : "Could not load issues");
          setIssues([]);
          setTotal(0);
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    void loadIssues();

    return () => {
      active = false;
    };
  }, [
    currentFilters.level,
    currentFilters.query,
    currentFilters.service,
    currentFilters.status,
    currentPage,
    currentSort.sortBy,
    currentSort.sortDirection,
    pageSize,
    reloadToken,
    team.id,
  ]);

  function updateSearch(next: {
    page?: number;
    pageSize?: number;
    query?: string;
    status?: string;
    service?: string;
    level?: string;
    sortBy?: "lastSeen" | "firstSeen" | "eventCount" | "service" | "level" | "status";
    sortDirection?: "asc" | "desc";
  }) {
    const params = new URLSearchParams(searchParams.toString());
    const page = next.page ?? currentPage;
    const nextPageSize = next.pageSize ?? pageSize;
    const query = next.query ?? currentFilters.query;
    const status = next.status ?? currentFilters.status;
    const service = next.service ?? currentFilters.service;
    const level = next.level ?? currentFilters.level;
    const sortBy = next.sortBy ?? currentSort.sortBy;
    const sortDirection = next.sortDirection ?? currentSort.sortDirection;

    if (page > 1) params.set("page", String(page));
    else params.delete("page");
    if (nextPageSize !== DEFAULT_PAGE_SIZE) params.set("pageSize", String(nextPageSize));
    else params.delete("pageSize");
    if (query) params.set("q", query);
    else params.delete("q");
    if (status) params.set("status", status);
    else params.delete("status");
    if (service) params.set("service", service);
    else params.delete("service");
    if (level) params.set("level", level);
    else params.delete("level");
    if (sortBy !== DEFAULT_SORT.sortBy) params.set("sortBy", sortBy);
    else params.delete("sortBy");
    if (sortDirection !== DEFAULT_SORT.sortDirection) params.set("sortDirection", sortDirection);
    else params.delete("sortDirection");

    const queryString = params.toString();
    router.push(queryString ? `${pathname}?${queryString}` : pathname, { scroll: false });
  }

  return (
    <div className="space-y-4 lg:space-y-6">
      <Card>
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm uppercase tracking-[0.24em] text-muted">Issues</p>
              <h2 className="mt-2 text-2xl font-semibold text-ink">Grouped errors and regressions</h2>
            </div>
            <p className="text-sm text-muted">{total} total</p>
          </div>

          <form
            className="grid gap-3 md:grid-cols-5"
            onSubmit={(event) => {
              event.preventDefault();
              const formData = new FormData(event.currentTarget);
              const [sortBy, sortDirection] = String(formData.get("sort") ?? "lastSeen:desc").split(":") as [
                "lastSeen" | "firstSeen" | "eventCount" | "service" | "level" | "status",
                "asc" | "desc",
              ];

              updateSearch({
                page: 1,
                query: String(formData.get("query") ?? "").trim(),
                status: String(formData.get("status") ?? ""),
                service: String(formData.get("service") ?? "").trim(),
                level: String(formData.get("level") ?? ""),
                sortBy,
                sortDirection,
              });
            }}
          >
            <input
              name="query"
              defaultValue={currentFilters.query}
              placeholder="Search title"
              className="rounded-xl border border-line bg-white px-3 py-2.5 text-sm text-ink outline-none focus:border-slate-400 dark:bg-white/10"
            />
            <select
              name="status"
              defaultValue={currentFilters.status}
              className="rounded-xl border border-line bg-white px-3 py-2.5 text-sm text-ink outline-none focus:border-slate-400 dark:bg-white/10"
            >
              <option value="">All statuses</option>
              <option value="NEW">NEW</option>
              <option value="ONGOING">ONGOING</option>
              <option value="RESOLVED">RESOLVED</option>
              <option value="IGNORED">IGNORED</option>
            </select>
            <input
              name="service"
              defaultValue={currentFilters.service}
              placeholder="Service"
              className="rounded-xl border border-line bg-white px-3 py-2.5 text-sm text-ink outline-none focus:border-slate-400 dark:bg-white/10"
            />
            <select
              name="level"
              defaultValue={currentFilters.level}
              className="rounded-xl border border-line bg-white px-3 py-2.5 text-sm text-ink outline-none focus:border-slate-400 dark:bg-white/10"
            >
              <option value="">All levels</option>
              <option value="fatal">fatal</option>
              <option value="error">error</option>
              <option value="warn">warn</option>
              <option value="info">info</option>
            </select>
            <select
              name="sort"
              defaultValue={`${currentSort.sortBy}:${currentSort.sortDirection}`}
              className="rounded-xl border border-line bg-white px-3 py-2.5 text-sm text-ink outline-none focus:border-slate-400 dark:bg-white/10"
            >
              <option value="lastSeen:desc">Newest activity</option>
              <option value="firstSeen:asc">Oldest first seen</option>
              <option value="eventCount:desc">Most events</option>
              <option value="service:asc">Service A-Z</option>
              <option value="status:asc">Status A-Z</option>
            </select>

            <div className="md:col-span-5 flex flex-wrap gap-2">
              <button
                type="submit"
                className="rounded-xl bg-slate-950 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-800"
              >
                Apply
              </button>
              <button
                type="button"
                onClick={() =>
                  updateSearch({
                    page: 1,
                    query: "",
                    status: "",
                    service: "",
                    level: "",
                    sortBy: DEFAULT_SORT.sortBy,
                    sortDirection: DEFAULT_SORT.sortDirection,
                  })
                }
                className="rounded-xl border border-line px-4 py-2 text-sm text-ink transition hover:border-slate-400"
              >
                Reset
              </button>
            </div>
          </form>
        </div>
      </Card>

      {loading ? (
        <SkeletonTable rows={8} />
      ) : error ? (
        <Card>
          <div className="py-12 text-center">
            <p className="text-base font-medium text-ink">Failed to load issues</p>
            <p className="mt-2 text-sm text-muted">{error}</p>
            <button
              type="button"
              onClick={() => setReloadToken((value) => value + 1)}
              className="mt-4 rounded-xl bg-slate-950 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-800"
            >
              Retry
            </button>
          </div>
        </Card>
      ) : issues.length === 0 ? (
        <Card>
          <div className="mt-4 flex flex-col items-center gap-3 py-10 text-center">
            <p className="font-medium text-ink">No issues found</p>
            <p className="max-w-sm text-sm text-muted">
              Refine the filters or broaden the search criteria to see grouped errors here.
            </p>
          </div>
        </Card>
      ) : (
        <Card>
          <div className="hidden overflow-x-auto md:block">
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

          <div className="space-y-3 md:hidden">
            {issues.map((issue) => (
              <article
                key={issue.id}
                className="rounded-2xl border border-line bg-white/70 p-4 dark:bg-white/5"
              >
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

          <PaginationControls
            page={currentPage}
            pageSize={pageSize}
            total={total}
            onPageChange={(page) => updateSearch({ page })}
            onPageSizeChange={(nextPageSize) => updateSearch({ page: 1, pageSize: nextPageSize })}
          />
        </Card>
      )}
    </div>
  );
}
