import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { LogAuthProvider, SHARED_VIEWS_REASON, canManageSharedViews } from "@/components/logs/log-auth-context";
import type { SavedLogView, TeamRole, TeamWithRole } from "@/types";

const mocks = vi.hoisted(() => ({
  createSavedLogView: vi.fn(),
  updateSavedLogView: vi.fn(),
  getSavedLogViews: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));

vi.mock("@/lib/api/client", () => ({
  createSavedLogView: mocks.createSavedLogView,
  updateSavedLogView: mocks.updateSavedLogView,
  getSavedLogViews: mocks.getSavedLogViews,
  deleteSavedLogView: vi.fn(),
  duplicateSavedLogView: vi.fn(),
  getNaturalExplanation: vi.fn(async () => null),
  getLogs: vi.fn(async () => ({
    logs: [],
    total: 0,
    executionTimeMs: 1,
    requestId: "r",
    partial: false,
    nextPageToken: undefined,
  })),
  getLogFacets: vi.fn(async () => ({ facets: [] })),
  getLogHistogram: vi.fn(async () => ({ buckets: [] })),
  getLogPatterns: vi.fn(async () => ({ patterns: [] })),
}));

vi.mock("@/hooks/use-log-search", async () => {
  const stable = {
    currentQuery: "",
    currentMode: "raw",
    currentPageToken: "",
    currentViewId: "v1",
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

// Child panels that are irrelevant to the sharing controls are stubbed.
vi.mock("@/components/logs/facet-sidebar", () => ({ FacetSidebar: () => null }));
vi.mock("@/components/logs/field-explorer", () => ({ FieldExplorer: () => null }));
vi.mock("@/components/logs/histogram-strip", () => ({ HistogramStrip: () => null }));
vi.mock("@/components/logs/pattern-table", () => ({ PatternTable: () => null }));
vi.mock("@/components/logs/log-table", () => ({ LogTable: () => null }));
vi.mock("@/components/logs/search-panel", () => ({ SearchPanel: () => null }));

import { SearchScreen } from "@/app/(dashboard)/logs/search/screen";

const view = {
  id: "v1",
  name: "Errors",
  isShared: false,
  isDefault: false,
  definition: { filters: [] },
} as unknown as SavedLogView;

function renderScreen(role: TeamRole | undefined) {
  const team = { id: "team-1", name: "T", role } as unknown as TeamWithRole;
  render(
    <LogAuthProvider value={{ team, token: "tok" }}>
      <SearchScreen />
    </LogAuthProvider>,
  );
}

beforeEach(() => {
  mocks.getSavedLogViews.mockResolvedValue({ views: [view] });
  mocks.createSavedLogView.mockResolvedValue({ view });
  mocks.updateSavedLogView.mockResolvedValue({ view });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

async function openSaveDialog() {
  const save = await screen.findByRole("button", { name: "Save New" });
  fireEvent.click(save);
  await screen.findByLabelText("Team-weit teilen");
}

describe.each(["OWNER", "ADMIN"] as const)("SearchScreen sharing controls for %s", (role) => {
  it("keeps Set Default enabled and lets the save dialog request shared and default", async () => {
    renderScreen(role);
    const setDefault = await screen.findByRole("button", { name: "Set Default" });
    expect(setDefault).toBeEnabled();
    fireEvent.click(setDefault);
    await waitFor(() =>
      expect(mocks.updateSavedLogView).toHaveBeenCalledWith("v1", "team-1", "tok", { isDefault: true }),
    );

    await openSaveDialog();
    expect(screen.getByLabelText("Team-weit teilen")).toBeEnabled();
    fireEvent.click(screen.getByLabelText("Team-weit teilen"));
    fireEvent.click(screen.getByLabelText("Als Standardansicht setzen"));
    fireEvent.click(screen.getByRole("button", { name: /speichern|bestätigen|ok/i }));
    await waitFor(() => expect(mocks.createSavedLogView).toHaveBeenCalledTimes(1));
    expect(mocks.createSavedLogView.mock.calls[0][1]).toMatchObject({ isShared: true, isDefault: true });
  });
});

describe.each(["MEMBER", "VIEWER", undefined] as const)("SearchScreen sharing controls for role %s", (role) => {
  it("disables Set Default with a visible, described reason and never calls the backend", async () => {
    renderScreen(role);
    const setDefault = await screen.findByRole("button", { name: "Set Default" });
    expect(setDefault).toBeDisabled();
    const hint = screen.getByText(SHARED_VIEWS_REASON);
    expect(setDefault.getAttribute("aria-describedby")).toBe(hint.id);
    fireEvent.click(setDefault);
    expect(mocks.updateSavedLogView).not.toHaveBeenCalled();
  });

  it("disables the dialog share and default options and saves a private view", async () => {
    renderScreen(role);
    await openSaveDialog();
    expect(screen.getByLabelText("Team-weit teilen")).toBeDisabled();
    expect(screen.getByLabelText("Als Standardansicht setzen")).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: /speichern|bestätigen|ok/i }));
    await waitFor(() => expect(mocks.createSavedLogView).toHaveBeenCalledTimes(1));
    expect(mocks.createSavedLogView.mock.calls[0][1]).toMatchObject({ isShared: false, isDefault: false });
  });
});

const sharedView = {
  id: "v1",
  name: "Shared errors",
  isShared: true,
  isDefault: false,
  definition: { filters: [] },
} as unknown as SavedLogView;

describe.each(["OWNER", "ADMIN", "MEMBER", "VIEWER"] as const)("SearchScreen manage controls for %s", (role) => {
  it("gates Overwrite/Rename/Delete with the reason on a shared selected view", async () => {
    mocks.getSavedLogViews.mockResolvedValue({ views: [sharedView] });
    renderScreen(role);
    const buttons = await Promise.all(
      (["Overwrite", "Rename", "Delete"] as const).map((name) => screen.findByRole("button", { name })),
    );
    const locked = !canManageSharedViews(role);
    for (const button of buttons) {
      if (locked) {
        expect(button).toBeDisabled();
        expect(button).toHaveAttribute("title", SHARED_VIEWS_REASON);
      } else {
        expect(button).toBeEnabled();
      }
    }
    expect(mocks.updateSavedLogView).not.toHaveBeenCalled();
  });
});
