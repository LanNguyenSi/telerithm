import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { Issue, LogEntry, Team } from "@/types";

const mocks = vi.hoisted(() => ({
  getIssues: vi.fn(),
}));

vi.mock("@/lib/api/client", () => ({ getIssues: mocks.getIssues }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  usePathname: () => "/issues",
  useSearchParams: () => new URLSearchParams(),
}));

import { LogTable } from "@/components/logs/log-table";
import { IssueExplorer } from "@/app/(dashboard)/issues/screen";

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

const issue: Issue = {
  id: "i1",
  teamId: "team-1",
  fingerprint: "f1",
  title: "Payment gateway timeouts",
  level: "error",
  service: "payment",
  status: "NEW",
  firstSeen: "2026-04-02T09:30:00.000Z",
  lastSeen: "2026-04-02T10:30:00.000Z",
  eventCount: 12,
};

const team = { id: "team-1", name: "Team One", slug: "team-one" } as Team;

/**
 * Both desktop tables scroll sideways, so the scroll container has to be a
 * focusable labelled region: a keyboard user can reach it and scroll it with
 * the arrow keys (axe scrollable-region-focusable).
 */
function assertFocusableRegion(name: string) {
  const region = screen.getByRole("region", { name });
  expect(region).toHaveAttribute("tabindex", "0");
  expect(region.querySelector("table")).not.toBeNull();
  expect(region.className).toContain("overflow-x-auto");
  expect(region.className).toMatch(/focus-visible:/);
}

beforeEach(() => {
  mocks.getIssues.mockResolvedValue({ issues: [issue], total: 1 });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("keyboard reachable table scroll regions", () => {
  it("makes the log table scroll container a labelled focusable region", async () => {
    render(<LogTable logs={[log]} />);
    await screen.findByRole("region", { name: "Logs table" });
    assertFocusableRegion("Logs table");
  });

  it("makes the issues table scroll container a labelled focusable region", async () => {
    render(<IssueExplorer team={team} token="tok" />);
    await screen.findByRole("region", { name: "Issues table" });
    assertFocusableRegion("Issues table");
  });
});
