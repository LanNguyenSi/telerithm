import { isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TeamWithRole } from "@/types";

// The props a server page hands to its client components are what Next writes
// into the RSC payload of the page, and the rendered tree is the HTML. Every
// authenticated page is rendered here with a known session token, and the token
// must appear in neither. The one exception is the logs page, whose live tail
// still authenticates its EventSource with the token in the stream URL.

const SECRET = "sess_known_cookie_value_4f1d2c";

const mocks = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  requireAdmin: vi.fn(),
  requireSession: vi.fn(),
  getOverview: vi.fn(),
  getSources: vi.fn(),
  getAlertIncidents: vi.fn(),
  getAlertRules: vi.fn(),
  getSubscriptions: vi.fn(),
  getAdminUsers: vi.fn(),
  getAdminTeams: vi.fn(),
}));

vi.mock("@/lib/auth/guard", () => ({
  requireAuth: mocks.requireAuth,
  requireAdmin: mocks.requireAdmin,
  requireSession: mocks.requireSession,
}));

vi.mock("@/lib/api/client", () => ({
  BROWSER_SESSION: { via: "proxy" },
  getOverview: mocks.getOverview,
  getSources: mocks.getSources,
  getAlertIncidents: mocks.getAlertIncidents,
  getAlertRules: mocks.getAlertRules,
  getSubscriptions: mocks.getSubscriptions,
  getAdminUsers: mocks.getAdminUsers,
  getAdminTeams: mocks.getAdminTeams,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), back: vi.fn() }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
  redirect: vi.fn(),
}));

import HomePage from "@/app/(dashboard)/page";
import DashboardsPage from "@/app/(dashboard)/dashboards/page";
import SettingsPage from "@/app/(dashboard)/settings/page";
import AlertsPage from "@/app/(dashboard)/alerts/page";
import SubscriptionsPage from "@/app/(dashboard)/alerts/subscriptions/page";
import AdminPage from "@/app/(dashboard)/admin/page";
import IssuesPage from "@/app/(dashboard)/issues/page";
import LogsLayout from "@/app/(dashboard)/logs/layout";
import LogsPage from "@/app/(dashboard)/logs/page";

const team = { id: "team-1", name: "Team One", slug: "team-one", role: "OWNER" } as TeamWithRole;
const user = { id: "u1", email: "a@example.test", name: "A", role: "ADMIN" };

/**
 * Every value reachable from the element tree: element types by name, all
 * props, nested elements and arrays. A token anywhere in a prop of any element,
 * server or client, shows up in this string.
 */
function serializeTree(node: unknown, seen = new WeakSet<object>()): string {
  if (node === null || node === undefined) return "";
  if (typeof node === "string" || typeof node === "number" || typeof node === "boolean") return String(node);
  if (typeof node === "function") return "";
  if (typeof node !== "object") return "";
  if (seen.has(node)) return "";
  seen.add(node);
  if (Array.isArray(node)) return node.map((item) => serializeTree(item, seen)).join(" ");
  if (isValidElement(node)) {
    const element = node as ReactElement<Record<string, unknown>>;
    return serializeTree(element.props, seen);
  }
  if (node instanceof Promise) return "";
  return Object.entries(node as Record<string, unknown>)
    .map(([key, value]) => `${key}=${serializeTree(value, seen)}`)
    .join(" ");
}

function html(node: ReactNode): string {
  return renderToStaticMarkup(<>{node}</>);
}

beforeEach(() => {
  mocks.requireAuth.mockResolvedValue({ token: SECRET, user, team });
  mocks.requireAdmin.mockResolvedValue({ token: SECRET, user });
  mocks.requireSession.mockResolvedValue({ token: SECRET, user });
  mocks.getOverview.mockResolvedValue({
    overview: { totalLogs: 1, errorRate: 0, services: [], recentIncidents: [] },
  });
  mocks.getSources.mockResolvedValue({
    sources: [{ id: "s1", teamId: "team-1", name: "api", type: "HTTP", retentionDays: 30, keyHint: "abcd" }],
  });
  mocks.getAlertIncidents.mockResolvedValue({ incidents: [] });
  mocks.getAlertRules.mockResolvedValue({ rules: [] });
  mocks.getSubscriptions.mockResolvedValue({ subscriptions: [] });
  mocks.getAdminUsers.mockResolvedValue({ users: [] });
  mocks.getAdminTeams.mockResolvedValue({ teams: [] });
});

afterEach(() => {
  vi.clearAllMocks();
});

const pages: Array<[string, () => Promise<ReactNode>]> = [
  ["overview", () => HomePage()],
  ["dashboards", () => DashboardsPage()],
  ["settings", () => SettingsPage()],
  ["alerts", () => AlertsPage()],
  ["alert subscriptions", () => SubscriptionsPage()],
  ["admin", () => AdminPage()],
  ["issues", () => IssuesPage()],
  ["logs layout (all log screens)", () => LogsLayout({ children: <p>child</p> })],
];

describe("the session token stays out of rendered pages", () => {
  it("the probe token reaches the server pages (control)", async () => {
    await SettingsPage();
    expect(mocks.getSources).toHaveBeenCalledWith("team-1", SECRET);
  });

  it.each(pages)("%s: the token is in no prop of the element tree and not in the HTML", async (_name, render) => {
    const tree = await render();
    expect(serializeTree(tree)).not.toContain(SECRET);
    expect(html(tree)).not.toContain(SECRET);
  });

  it("the serializer finds a token handed to a client component (control)", () => {
    function Leaky(props: { token: string }) {
      return <span>{props.token.length}</span>;
    }
    expect(serializeTree(<div><Leaky token={SECRET} /></div>)).toContain(SECRET);
  });

  // Known exception until live tail gets its own stream ticket: when that
  // lands, this assertion flips to not.toContain.
  it("logs page: the live tail still receives the token for its stream URL", async () => {
    const tree = await LogsPage();
    expect(serializeTree(tree)).toContain(SECRET);
  });
});
