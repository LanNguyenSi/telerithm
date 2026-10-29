import { Suspense } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, act, render, screen } from "@testing-library/react";
import type { LogEntry, TeamWithRole } from "@/types";

const mocks = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  requireAdmin: vi.fn(),
  getOverview: vi.fn(),
  getLogs: vi.fn(),
  getIssues: vi.fn(),
  getAlertIncidents: vi.fn(),
  getAlertRules: vi.fn(),
  getSubscriptions: vi.fn(),
  getSources: vi.fn(),
  getAdminUsers: vi.fn(),
  getAdminTeams: vi.fn(),
  getLogById: vi.fn(),
  getLogContext: vi.fn(),
  getSavedLogViews: vi.fn(),
  getNaturalExplanation: vi.fn(),
  getLogFacets: vi.fn(),
  getLogHistogram: vi.fn(),
  getLogPatterns: vi.fn(),
  createSavedLogView: vi.fn(),
  updateSavedLogView: vi.fn(),
  deleteSavedLogView: vi.fn(),
  duplicateSavedLogView: vi.fn(),
}));

vi.mock("@/lib/auth/guard", () => ({ requireAuth: mocks.requireAuth, requireAdmin: mocks.requireAdmin }));

vi.mock("@/lib/api/client", () => ({
  getOverview: mocks.getOverview,
  getLogs: mocks.getLogs,
  getIssues: mocks.getIssues,
  getAlertIncidents: mocks.getAlertIncidents,
  getAlertRules: mocks.getAlertRules,
  getSubscriptions: mocks.getSubscriptions,
  getSources: mocks.getSources,
  getAdminUsers: mocks.getAdminUsers,
  getAdminTeams: mocks.getAdminTeams,
  getLogById: mocks.getLogById,
  getLogContext: mocks.getLogContext,
  getSavedLogViews: mocks.getSavedLogViews,
  getNaturalExplanation: mocks.getNaturalExplanation,
  getLogFacets: mocks.getLogFacets,
  getLogHistogram: mocks.getLogHistogram,
  getLogPatterns: mocks.getLogPatterns,
  createSavedLogView: mocks.createSavedLogView,
  updateSavedLogView: mocks.updateSavedLogView,
  deleteSavedLogView: mocks.deleteSavedLogView,
  duplicateSavedLogView: mocks.duplicateSavedLogView,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  usePathname: () => "/logs/search",
  useSearchParams: () => new URLSearchParams(),
  redirect: vi.fn(),
}));

// Panels whose own content is not the page heading are stubbed so this suite
// only asserts the page-level heading structure.
vi.mock("@/components/logs/live-tail", () => ({ LiveTail: () => null }));
vi.mock("@/components/logs/log-table", () => ({ LogTable: () => null }));
vi.mock("@/components/logs/search-panel", () => ({ SearchPanel: () => null }));
vi.mock("@/components/logs/facet-sidebar", () => ({ FacetSidebar: () => null }));
vi.mock("@/components/logs/field-explorer", () => ({ FieldExplorer: () => null }));
vi.mock("@/components/logs/histogram-strip", () => ({ HistogramStrip: () => null }));
vi.mock("@/components/logs/pattern-table", () => ({ PatternTable: () => null }));
vi.mock("@/components/alerts/alert-rules-panel", () => ({ AlertRulesPanel: () => null }));
vi.mock("@/components/settings/sources-panel", () => ({ SourcesPanel: () => null }));
vi.mock("@/components/settings/theme-switch", () => ({ ThemeSwitch: () => null }));
vi.mock("@/components/admin/user-table", () => ({ UserTable: () => null }));

vi.mock("@/hooks/use-log-search", () => {
  const stable = {
    currentQuery: "",
    currentMode: "raw",
    currentPageToken: "",
    currentViewId: "",
    currentPage: 1,
    pageSize: 50,
    currentFilters: { level: "", service: "", host: "" },
    currentSourceId: "",
    currentExclusions: [],
    currentFacetSelections: [],
    currentColumns: [],
    currentTimeRange: { startTime: "2026-01-01T00:00:00Z", endTime: "2026-01-01T01:00:00Z" },
    currentTimeMode: "rel",
    currentRelativeDuration: "1h",
    currentRefresh: "off",
    currentShareAbsoluteTime: false,
    currentSort: { sortBy: "timestamp", sortDirection: "desc" },
    currentDefinition: { filters: [] },
    fallbackRange: { startTime: "2026-01-01T00:00:00Z", endTime: "2026-01-01T01:00:00Z" },
    updateSearch: vi.fn(),
  };
  return {
    DEFAULT_RELATIVE_DURATION: "1h",
    DEFAULT_PAGE_SIZE: 50,
    DEFAULT_SORT: { sortBy: "timestamp", sortDirection: "desc" },
    FACET_FIELDS: [],
    useLogSearch: () => stable,
  };
});

import { LogAuthProvider } from "@/components/logs/log-auth-context";
import HomePage from "@/app/(dashboard)/page";
import DashboardsPage from "@/app/(dashboard)/dashboards/page";
import AlertsPage from "@/app/(dashboard)/alerts/page";
import SubscriptionsPage from "@/app/(dashboard)/alerts/subscriptions/page";
import SettingsPage from "@/app/(dashboard)/settings/page";
import AdminPage from "@/app/(dashboard)/admin/page";
import { TodayScreen } from "@/app/(dashboard)/logs/today-screen";
import { SearchScreen } from "@/app/(dashboard)/logs/search/screen";
import { LogDetailScreen } from "@/app/(dashboard)/logs/[id]/screen";
import { IssueExplorer } from "@/app/(dashboard)/issues/screen";

const team = { id: "team-1", name: "Team One", slug: "team-one", role: "OWNER" } as TeamWithRole;

const log: LogEntry = {
  id: "l1",
  teamId: "team-1",
  sourceId: "s1",
  timestamp: "2026-04-02T10:30:00.000Z",
  level: "error",
  service: "payment",
  host: "api-1",
  message: "Payment failed",
  fields: {},
};

/**
 * Every dashboard page carries exactly one h1 that names the page, and the
 * heading levels below it must not skip a level (axe page-has-heading-one and
 * heading-order).
 */
function assertPageHeading(title: string) {
  const headings = Array.from(document.querySelectorAll("h1, h2, h3, h4, h5, h6"));
  const levelOf = (element: Element) => Number(element.tagName.slice(1));
  const h1s = headings.filter((element) => levelOf(element) === 1);

  expect(h1s).toHaveLength(1);
  expect(h1s[0]).toHaveTextContent(title);
  expect(levelOf(headings[0])).toBe(1);
  for (let index = 1; index < headings.length; index += 1) {
    expect(levelOf(headings[index])).toBeLessThanOrEqual(levelOf(headings[index - 1]) + 1);
  }
}

beforeEach(() => {
  mocks.requireAuth.mockResolvedValue({ team, token: "tok" });
  mocks.requireAdmin.mockResolvedValue({ team, token: "tok" });
  mocks.getOverview.mockResolvedValue({
    overview: { totalLogs: 12, errorRate: 3, services: [], recentIncidents: [] },
  });
  mocks.getLogs.mockResolvedValue({ logs: [log], total: 1 });
  mocks.getIssues.mockResolvedValue({ issues: [], total: 0 });
  mocks.getAlertIncidents.mockResolvedValue({ incidents: [] });
  mocks.getAlertRules.mockResolvedValue({ rules: [] });
  mocks.getSubscriptions.mockResolvedValue({ subscriptions: [] });
  mocks.getSources.mockResolvedValue({ sources: [] });
  mocks.getAdminUsers.mockResolvedValue({ users: [] });
  mocks.getAdminTeams.mockResolvedValue({ teams: [] });
  mocks.getLogById.mockResolvedValue({ log });
  mocks.getLogContext.mockResolvedValue({ before: [], after: [] });
  mocks.getSavedLogViews.mockResolvedValue({ views: [] });
  mocks.getNaturalExplanation.mockResolvedValue(null);
  mocks.getLogFacets.mockResolvedValue({ facets: [] });
  mocks.getLogHistogram.mockResolvedValue({ buckets: [] });
  mocks.getLogPatterns.mockResolvedValue({ patterns: [] });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderInLogAuth(ui: React.ReactElement) {
  render(
    <LogAuthProvider value={{ team, token: "tok" }}>
      <Suspense fallback={null}>{ui}</Suspense>
    </LogAuthProvider>,
  );
}

describe("dashboard page headings", () => {
  it("names the overview page with one h1", async () => {
    render(await HomePage());
    assertPageHeading("Overview");
  });

  it("names the dashboards page with one h1", async () => {
    render(await DashboardsPage());
    assertPageHeading("Dashboards");
  });

  it("names the logs today page with one h1", () => {
    renderInLogAuth(<TodayScreen />);
    assertPageHeading("Logs");
  });

  it("names the log search page with one h1", () => {
    renderInLogAuth(<SearchScreen />);
    assertPageHeading("Log Search");
  });

  it("names the log detail page with one h1", async () => {
    await act(async () => {
      renderInLogAuth(<LogDetailScreen paramsPromise={Promise.resolve({ id: "l1" })} />);
    });
    await screen.findByText("Log Detail");
    assertPageHeading("Log Detail");
  });

  it("names the issues page with one h1", () => {
    render(<IssueExplorer team={team} token="tok" />);
    assertPageHeading("Issues");
  });

  it("names the alerts page with one h1", async () => {
    render(await AlertsPage());
    assertPageHeading("Alerts");
  });

  it("names the subscriptions page with one h1", async () => {
    render(await SubscriptionsPage());
    assertPageHeading("Subscriptions");
  });

  it("names the settings page with one h1", async () => {
    render(await SettingsPage());
    assertPageHeading("Settings");
  });

  it("names the admin page with one h1", async () => {
    render(await AdminPage());
    assertPageHeading("Admin");
  });
});
