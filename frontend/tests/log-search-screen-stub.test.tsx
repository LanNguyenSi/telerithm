import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { LogAuthProvider } from "@/components/logs/log-auth-context";
import type { SavedLogView, TeamWithRole } from "@/types";

// An OWNER/ADMIN clearing or setting the default on a view they cannot read
// gets a stub back (no name, no definition). The screen must refetch the list
// and must not apply the stub as a view (applySavedView reads definition).
const mocks = vi.hoisted(() => ({
  createSavedLogView: vi.fn(),
  updateSavedLogView: vi.fn(),
  getSavedLogViews: vi.fn(),
  updateSearch: vi.fn(),
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
    updateSearch: mocks.updateSearch,
  };
  return {
    DEFAULT_RELATIVE_DURATION: "1h",
    DEFAULT_PAGE_SIZE: 50,
    DEFAULT_SORT: { sortBy: "timestamp", sortDirection: "desc" },
    FACET_FIELDS: [],
    useLogSearch: () => stable,
  };
});

vi.mock("@/components/logs/facet-sidebar", () => ({ FacetSidebar: () => null }));
vi.mock("@/components/logs/field-explorer", () => ({ FieldExplorer: () => null }));
vi.mock("@/components/logs/histogram-strip", () => ({ HistogramStrip: () => null }));
vi.mock("@/components/logs/pattern-table", () => ({ PatternTable: () => null }));
vi.mock("@/components/logs/log-table", () => ({ LogTable: () => null }));
vi.mock("@/components/logs/search-panel", () => ({ SearchPanel: () => null }));

import { SearchScreen } from "@/app/(dashboard)/logs/search/screen";

const view = {
  id: "v1",
  teamId: "team-1",
  name: "Errors",
  isShared: false,
  isDefault: false,
  definition: { text: "level:error", filters: [] },
} as unknown as SavedLogView;

const stub = {
  id: "v1",
  teamId: "team-1",
  ownerUserId: "someone-else",
  isShared: false,
  isDefault: true,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};

function renderScreen() {
  const team = { id: "team-1", name: "T", role: "OWNER" } as unknown as TeamWithRole;
  render(
    <LogAuthProvider value={{ team, token: "tok" }}>
      <SearchScreen />
    </LogAuthProvider>,
  );
}

async function clickSetDefault() {
  const setDefault = await screen.findByRole("button", { name: "Set Default" });
  await waitFor(() => expect(mocks.getSavedLogViews).toHaveBeenCalledTimes(1));
  mocks.updateSearch.mockClear();
  fireEvent.click(setDefault);
  await waitFor(() =>
    expect(mocks.updateSavedLogView).toHaveBeenCalledWith("v1", "team-1", "tok", { isDefault: true }),
  );
  // The list is refetched after the update resolves.
  await waitFor(() => expect(mocks.getSavedLogViews).toHaveBeenCalledTimes(2));
}

beforeEach(() => {
  mocks.getSavedLogViews.mockResolvedValue({ views: [view] });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("SearchScreen update returning a saved view stub", () => {
  it("refetches the list and does not apply the stub as a view", async () => {
    mocks.updateSavedLogView.mockResolvedValue({ view: stub });
    renderScreen();
    await clickSetDefault();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(mocks.updateSearch).not.toHaveBeenCalled();
  });

  it("applies a full view returned by the update (control)", async () => {
    mocks.updateSavedLogView.mockResolvedValue({ view });
    renderScreen();
    await clickSetDefault();
    await waitFor(() =>
      expect(mocks.updateSearch).toHaveBeenCalledWith(
        expect.objectContaining({ query: "level:error", page: 1 }),
      ),
    );
  });
});
