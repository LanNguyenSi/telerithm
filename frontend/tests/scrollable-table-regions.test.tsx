import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
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
 * jsdom has no layout, so `scrollWidth` and `clientWidth` are always 0 and the
 * hook would never see overflow. Each test decides the box: prototype stubs for
 * the case under test, per element when only that region should change.
 */
function stubLayout(scrollWidth: number, clientWidth: number) {
  Object.defineProperty(HTMLElement.prototype, "scrollWidth", {
    configurable: true,
    get: () => scrollWidth,
  });
  Object.defineProperty(HTMLElement.prototype, "clientWidth", {
    configurable: true,
    get: () => clientWidth,
  });
}

function stubElementLayout(node: HTMLElement, scrollWidth: number, clientWidth: number) {
  Object.defineProperty(node, "scrollWidth", { configurable: true, get: () => scrollWidth });
  Object.defineProperty(node, "clientWidth", { configurable: true, get: () => clientWidth });
}

function clearLayoutStubs() {
  const proto = HTMLElement.prototype as unknown as Record<string, unknown>;
  delete proto.scrollWidth;
  delete proto.clientWidth;
}

/**
 * Controllable ResizeObserver, in this file only: `resize()` is how the test
 * says "the box changed", and `disconnected` records the cleanup the hook owes
 * the browser.
 */
class ResizeObserverStub {
  static instances: ResizeObserverStub[] = [];

  readonly targets: Element[] = [];
  disconnected = false;

  constructor(private readonly callback: ResizeObserverCallback) {
    ResizeObserverStub.instances.push(this);
  }

  observe(target: Element) {
    this.targets.push(target);
  }

  unobserve() {}

  disconnect() {
    this.disconnected = true;
  }

  resize() {
    this.callback([], this as unknown as ResizeObserver);
  }
}

function observerFor(node: Element): ResizeObserverStub {
  const observer = ResizeObserverStub.instances.find((instance) => instance.targets.includes(node));
  if (!observer) throw new Error("no ResizeObserver is watching the region");
  return observer;
}

/** A scrollable region that overflows: focusable labelled box, ring, tab stop. */
function assertFocusableRegion(name: string) {
  const region = screen.getByRole("region", { name });
  expect(region).toHaveAttribute("tabindex", "0");
  expect(region.querySelector("table")).not.toBeNull();
  expect(region.className).toContain("overflow-x-auto");
  expect(region.className).toMatch(/focus-visible:/);
  // The light-theme ring needs 3:1 against the near-white card (WCAG 1.4.11):
  // slate-600 is about 7.6:1 there, slate-400 only about 2.5:1.
  expect(region.className).toContain("focus-visible:outline-slate-600");
  return region;
}

/** A region whose table fits: same labelled box, and nothing to tab to. */
function assertFittingRegion(name: string) {
  const region = screen.getByRole("region", { name });
  expect(region).not.toHaveAttribute("tabindex");
  expect(region.querySelector("table")).not.toBeNull();
  expect(region.className).toContain("overflow-x-auto");
  expect(region.className).toMatch(/focus-visible:/);
  return region;
}

beforeEach(() => {
  ResizeObserverStub.instances = [];
  vi.stubGlobal("ResizeObserver", ResizeObserverStub);
  mocks.getIssues.mockResolvedValue({ issues: [issue], total: 1 });
});

afterEach(() => {
  cleanup();
  clearLayoutStubs();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("keyboard reachable table scroll regions", () => {
  it("makes the overflowing log table scroll container a labelled focusable region", async () => {
    stubLayout(1200, 800);
    render(<LogTable logs={[log]} />);
    await screen.findByRole("region", { name: "Logs table" });
    assertFocusableRegion("Logs table");
  });

  it("makes the overflowing issues table scroll container a labelled focusable region", async () => {
    stubLayout(1200, 800);
    render(<IssueExplorer team={team} token="tok" />);
    await screen.findByRole("region", { name: "Issues table" });
    assertFocusableRegion("Issues table");
  });
});

describe("a table that fits is not a tab stop", () => {
  it("gives the fitting log table region no tabindex", async () => {
    stubLayout(800, 800);
    render(<LogTable logs={[log]} />);
    await screen.findByRole("region", { name: "Logs table" });
    assertFittingRegion("Logs table");
  });

  it("gives the fitting issues table region no tabindex", async () => {
    stubLayout(800, 800);
    render(<IssueExplorer team={team} token="tok" />);
    await screen.findByRole("region", { name: "Issues table" });
    assertFittingRegion("Issues table");
  });
});

describe("resize flips the tab stop", () => {
  it("adds the tab stop when a resize takes a fitting log table into overflow", async () => {
    stubLayout(800, 800);
    render(<LogTable logs={[log]} />);
    const region = await screen.findByRole("region", { name: "Logs table" });
    expect(region).not.toHaveAttribute("tabindex");

    stubLayout(1200, 800);
    await act(async () => {
      observerFor(region).resize();
    });
    expect(region).toHaveAttribute("tabindex", "0");
  });

  it("removes the tab stop when a resize takes an overflowing issues table back to fit", async () => {
    stubLayout(1200, 800);
    render(<IssueExplorer team={team} token="tok" />);
    const region = await screen.findByRole("region", { name: "Issues table" });
    expect(region).toHaveAttribute("tabindex", "0");

    stubLayout(966, 966);
    await act(async () => {
      observerFor(region).resize();
    });
    expect(region).not.toHaveAttribute("tabindex");
  });
});

describe("re-measure when the content changes", () => {
  it("adds the tab stop when extra columns make a fitting log table overflow", async () => {
    stubLayout(800, 800);
    const { rerender } = render(<LogTable logs={[log]} />);
    const region = await screen.findByRole("region", { name: "Logs table" });
    expect(region).not.toHaveAttribute("tabindex");

    // A new column widens the table without resizing the region, so ResizeObserver
    // never fires; the changed review key is what re-measures it. The wider
    // content shows up as a bigger scrollWidth on that region only.
    stubElementLayout(region, 1200, 800);
    rerender(<LogTable logs={[log]} extraColumns={["requestId"]} />);
    expect(region).toHaveAttribute("tabindex", "0");
  });

  it("adds the tab stop when a different page of rows makes a fitting log table overflow", async () => {
    stubLayout(800, 800);
    const { rerender } = render(<LogTable logs={[log]} />);
    const region = await screen.findByRole("region", { name: "Logs table" });
    expect(region).not.toHaveAttribute("tabindex");

    stubElementLayout(region, 1200, 800);
    rerender(
      <LogTable
        logs={[
          { ...log, id: "l2", service: "checkout" },
          { ...log, id: "l3", service: "billing" },
        ]}
      />,
    );
    expect(region).toHaveAttribute("tabindex", "0");
  });

  it("adds no tab stop when a review of a fitting table still finds no overflow", async () => {
    stubLayout(800, 800);
    const { rerender } = render(<LogTable logs={[log]} />);
    const region = await screen.findByRole("region", { name: "Logs table" });

    rerender(
      <LogTable
        logs={[
          { ...log, id: "l2", service: "checkout" },
          { ...log, id: "l3", service: "billing" },
        ]}
        extraColumns={["requestId"]}
      />,
    );
    expect(region).not.toHaveAttribute("tabindex");
    // The earlier review's observer is gone, only the current one is still open.
    const open = ResizeObserverStub.instances.filter((instance) => !instance.disconnected);
    expect(open).toHaveLength(1);
    expect(open[0].targets.includes(region)).toBe(true);
  });
});

describe("ResizeObserver fallback and cleanup", () => {
  it("measures once through the initial measure when ResizeObserver is missing", async () => {
    vi.stubGlobal("ResizeObserver", undefined);
    stubLayout(1200, 800);
    render(<LogTable logs={[log]} />);
    const region = await screen.findByRole("region", { name: "Logs table" });
    expect(region).toHaveAttribute("tabindex", "0");
  });

  it("adds no tab stop through the initial measure when ResizeObserver is missing and the table fits", async () => {
    vi.stubGlobal("ResizeObserver", undefined);
    stubLayout(800, 800);
    render(<LogTable logs={[log]} />);
    const region = await screen.findByRole("region", { name: "Logs table" });
    expect(region).not.toHaveAttribute("tabindex");
  });

  it("disconnects the observer when the table unmounts", async () => {
    stubLayout(1200, 800);
    const { unmount } = render(<LogTable logs={[log]} />);
    const region = await screen.findByRole("region", { name: "Logs table" });
    const observer = observerFor(region);
    expect(observer.disconnected).toBe(false);

    unmount();
    expect(observer.disconnected).toBe(true);
  });
});
