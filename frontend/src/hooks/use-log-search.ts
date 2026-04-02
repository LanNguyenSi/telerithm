"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { SavedLogViewDefinition } from "@/types";

/* ── Constants ── */

export const DEFAULT_PAGE_SIZE = 50;
export const ALLOWED_PAGE_SIZES = [25, 50, 100];
export const DEFAULT_SORT = { sortBy: "timestamp" as const, sortDirection: "desc" as const };
export const DEFAULT_LOOKBACK_MS = 60 * 60 * 1000;
export const DEFAULT_RELATIVE_DURATION = "1h";
const EXCLUDE_PARAM_SEPARATOR = "::";
const RELATIVE_DURATION_MS: Record<RelativeDuration, number> = {
  "5m": 5 * 60 * 1000,
  "15m": 15 * 60 * 1000,
  "1h": 60 * 60 * 1000,
  "6h": 6 * 60 * 60 * 1000,
  "24h": 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
};
const REFRESH_VALUES = new Set(["off", "10s", "30s", "1m"]);
const TIME_MODES = new Set(["rel", "abs"]);
const ABSOLUTE_RANGE_STORAGE_KEY = "telerithm.logs.search.absoluteRange.v1";

export const FACET_FIELDS: Array<
  "service" | "level" | "host" | "sourceId" | "env" | "region" | "status_code" | "route"
> = ["service", "level", "host", "sourceId", "env", "region", "status_code", "route"];

/* ── Types ── */

export interface ExclusionChip {
  field: string;
  value: string;
}

export interface FacetSelection {
  field: string;
  value: string;
}

export interface SearchUpdate {
  query?: string;
  mode?: "raw" | "patterns";
  pageToken?: string;
  viewId?: string;
  page?: number;
  pageSize?: number;
  sourceId?: string;
  exclusions?: ExclusionChip[];
  facets?: FacetSelection[];
  columns?: string[];
  startTime?: string;
  endTime?: string;
  timeMode?: TimeMode;
  relativeDuration?: RelativeDuration;
  refresh?: RefreshInterval;
  shareAbsoluteTime?: boolean;
  level?: string;
  service?: string;
  host?: string;
  sortBy?: "timestamp" | "level" | "service" | "host";
  sortDirection?: "asc" | "desc";
}

export type TimeMode = "rel" | "abs";
export type RelativeDuration = "5m" | "15m" | "1h" | "6h" | "24h" | "7d";
export type RefreshInterval = "off" | "10s" | "30s" | "1m";

/* ── Helpers ── */

function defaultTimeRange(): { startTime: string; endTime: string } {
  const end = new Date();
  const start = new Date(end.getTime() - DEFAULT_LOOKBACK_MS);
  return { startTime: start.toISOString(), endTime: end.toISOString() };
}

function isRelativeDuration(value: string | null): value is RelativeDuration {
  return value !== null && value in RELATIVE_DURATION_MS;
}

function computeRelativeRange(
  duration: RelativeDuration,
  endAnchorIso: string,
): { startTime: string; endTime: string } {
  const end = new Date(endAnchorIso);
  const safeEnd = Number.isNaN(end.getTime()) ? new Date() : end;
  const start = new Date(safeEnd.getTime() - RELATIVE_DURATION_MS[duration]);
  return { startTime: start.toISOString(), endTime: safeEnd.toISOString() };
}

function isValidIso(value: string | null): value is string {
  if (!value) return false;
  return !Number.isNaN(new Date(value).getTime());
}

function parseExclusions(params: URLSearchParams): ExclusionChip[] {
  return params
    .getAll("exclude")
    .map((token) => {
      const [field, value] = token.split(EXCLUDE_PARAM_SEPARATOR);
      if (!field || !value) return null;
      return { field: decodeURIComponent(field), value: decodeURIComponent(value) };
    })
    .filter((item): item is ExclusionChip => item !== null);
}

function parseFacetSelections(params: URLSearchParams): FacetSelection[] {
  return params
    .getAll("facet")
    .map((token) => {
      const [field, value] = token.split(EXCLUDE_PARAM_SEPARATOR);
      if (!field || !value) return null;
      return { field: decodeURIComponent(field), value: decodeURIComponent(value) };
    })
    .filter((item): item is FacetSelection => item !== null);
}

function parseColumns(params: URLSearchParams): string[] {
  return params
    .getAll("col")
    .map((value) => decodeURIComponent(value))
    .filter((value, index, values) => value.length > 0 && values.indexOf(value) === index);
}

function readStoredAbsoluteRange(): { startTime: string; endTime: string } | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(ABSOLUTE_RANGE_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { startTime?: string; endTime?: string };
    const { startTime, endTime } = parsed;
    if (!isValidIso(startTime ?? null) || !isValidIso(endTime ?? null)) return null;
    return { startTime: startTime as string, endTime: endTime as string };
  } catch {
    return null;
  }
}

function writeStoredAbsoluteRange(range: { startTime: string; endTime: string }): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(ABSOLUTE_RANGE_STORAGE_KEY, JSON.stringify(range));
  } catch {
    // Ignore storage failures and keep URL-driven behavior.
  }
}

/* ── Hook ── */

export function useLogSearch() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [fallbackRange] = useState(() => defaultTimeRange());
  const [localAbsoluteRange, setLocalAbsoluteRange] = useState(() => defaultTimeRange());

  const searchParamString = searchParams.toString();

  const currentQuery = searchParams.get("q")?.trim() ?? "";
  const currentMode = searchParams.get("mode") === "patterns" ? ("patterns" as const) : ("raw" as const);
  const currentPageToken = searchParams.get("pageToken") ?? "";
  const currentViewId = searchParams.get("viewId") ?? "";
  const currentPage = Math.max(1, Number.parseInt(searchParams.get("page") ?? "1", 10) || 1);
  const rawPageSize =
    Number.parseInt(searchParams.get("pageSize") ?? `${DEFAULT_PAGE_SIZE}`, 10) || DEFAULT_PAGE_SIZE;
  const pageSize = ALLOWED_PAGE_SIZES.includes(rawPageSize) ? rawPageSize : DEFAULT_PAGE_SIZE;
  const currentFilters = {
    level: searchParams.get("level") ?? "",
    service: searchParams.get("service") ?? "",
    host: searchParams.get("host") ?? "",
  };
  const currentSourceId = searchParams.get("sourceId") ?? "";
  const currentExclusions = useMemo(
    () => parseExclusions(new URLSearchParams(searchParamString)),
    [searchParamString],
  );
  const currentFacetSelections = useMemo(
    () => parseFacetSelections(new URLSearchParams(searchParamString)),
    [searchParamString],
  );
  const currentColumns = useMemo(
    () => parseColumns(new URLSearchParams(searchParamString)),
    [searchParamString],
  );
  const currentTimeMode = TIME_MODES.has(searchParams.get("tr") ?? "") // new semantic params
    ? (searchParams.get("tr") as TimeMode)
    : "rel";
  const currentRelativeDuration = isRelativeDuration(searchParams.get("dur"))
    ? (searchParams.get("dur") as RelativeDuration)
    : DEFAULT_RELATIVE_DURATION;
  const currentRefresh = REFRESH_VALUES.has(searchParams.get("refresh") ?? "")
    ? (searchParams.get("refresh") as RefreshInterval)
    : "off";
  const currentShareAbsoluteTime = searchParams.get("shareAbs") === "1";
  const absoluteFrom = searchParams.get("from") ?? searchParams.get("startTime"); // backward compatible
  const absoluteTo = searchParams.get("to") ?? searchParams.get("endTime"); // backward compatible
  const currentTimeRange =
    currentTimeMode === "abs"
      ? isValidIso(absoluteFrom) && isValidIso(absoluteTo)
        ? { startTime: absoluteFrom, endTime: absoluteTo }
        : localAbsoluteRange
      : computeRelativeRange(currentRelativeDuration, fallbackRange.endTime);
  const currentSort = {
    sortBy:
      (searchParams.get("sortBy") as "timestamp" | "level" | "service" | "host" | null) ??
      DEFAULT_SORT.sortBy,
    sortDirection: (searchParams.get("sortDirection") as "asc" | "desc" | null) ?? DEFAULT_SORT.sortDirection,
  };

  useEffect(() => {
    if (currentTimeMode !== "abs") return;
    if (isValidIso(absoluteFrom) && isValidIso(absoluteTo)) {
      const next = { startTime: absoluteFrom, endTime: absoluteTo };
      setLocalAbsoluteRange(next);
      writeStoredAbsoluteRange(next);
      return;
    }
    const stored = readStoredAbsoluteRange();
    if (stored) setLocalAbsoluteRange(stored);
  }, [absoluteFrom, absoluteTo, currentTimeMode]);

  const currentDefinition = useMemo<SavedLogViewDefinition>(
    () => ({
      mode: currentMode,
      startTime: currentTimeRange.startTime,
      endTime: currentTimeRange.endTime,
      relativeTime: currentTimeMode === "rel" ? currentRelativeDuration : undefined,
      text: currentQuery || undefined,
      sourceId: currentSourceId || undefined,
      filters: [
        ...(currentFilters.level
          ? [{ field: "level", operator: "eq" as const, value: currentFilters.level }]
          : []),
        ...(currentFilters.service
          ? [{ field: "service", operator: "contains" as const, value: currentFilters.service }]
          : []),
        ...(currentFilters.host
          ? [{ field: "host", operator: "contains" as const, value: currentFilters.host }]
          : []),
      ],
      columns: currentColumns,
      sortBy: currentSort.sortBy,
      sortDirection: currentSort.sortDirection,
      facets: currentFacetSelections,
      exclusions: currentExclusions,
      pageSize,
    }),
    [
      currentColumns,
      currentExclusions,
      currentFacetSelections,
      currentFilters.host,
      currentFilters.level,
      currentFilters.service,
      currentMode,
      currentQuery,
      currentRelativeDuration,
      currentTimeMode,
      currentSort.sortBy,
      currentSort.sortDirection,
      currentSourceId,
      currentTimeRange.endTime,
      currentTimeRange.startTime,
      pageSize,
    ],
  );

  function updateSearch(next: SearchUpdate) {
    const params = new URLSearchParams(searchParams.toString());
    const query = next.query ?? currentQuery;
    const mode = next.mode ?? currentMode;
    const pageToken =
      next.pageToken ?? (next.page !== undefined && next.page !== currentPage ? "" : currentPageToken);
    const viewId = next.viewId ?? currentViewId;
    const page = next.page ?? currentPage;
    const nextPageSize = next.pageSize ?? pageSize;
    const sourceId = next.sourceId ?? currentSourceId;
    const exclusions = next.exclusions ?? currentExclusions;
    const facets = next.facets ?? currentFacetSelections;
    const columns = next.columns ?? currentColumns;
    const requestedTimeMode = next.timeMode ?? currentTimeMode;
    const requestedRelativeDuration = next.relativeDuration ?? currentRelativeDuration;
    const requestedRefresh = next.refresh ?? currentRefresh;
    const requestedShareAbsoluteTime = next.shareAbsoluteTime ?? currentShareAbsoluteTime;
    const hasAbsoluteOverride = Boolean(next.startTime || next.endTime);
    const startTime = next.startTime ?? currentTimeRange.startTime;
    const endTime = next.endTime ?? currentTimeRange.endTime;
    const nextTimeMode: TimeMode = hasAbsoluteOverride ? "abs" : requestedTimeMode;
    const level = next.level ?? currentFilters.level;
    const service = next.service ?? currentFilters.service;
    const host = next.host ?? currentFilters.host;
    const sortBy = next.sortBy ?? currentSort.sortBy;
    const sortDirection = next.sortDirection ?? currentSort.sortDirection;

    if (query) params.set("q", query);
    else params.delete("q");
    if (mode === "patterns") params.set("mode", "patterns");
    else params.delete("mode");
    if (pageToken) params.set("pageToken", pageToken);
    else params.delete("pageToken");
    if (viewId) params.set("viewId", viewId);
    else params.delete("viewId");
    if (page > 1) params.set("page", String(page));
    else params.delete("page");
    if (nextPageSize !== DEFAULT_PAGE_SIZE) params.set("pageSize", String(nextPageSize));
    else params.delete("pageSize");
    if (sourceId) params.set("sourceId", sourceId);
    else params.delete("sourceId");
    params.delete("exclude");
    for (const exclusion of exclusions) {
      params.append(
        "exclude",
        `${encodeURIComponent(exclusion.field)}${EXCLUDE_PARAM_SEPARATOR}${encodeURIComponent(exclusion.value)}`,
      );
    }
    params.delete("facet");
    for (const facet of facets) {
      params.append(
        "facet",
        `${encodeURIComponent(facet.field)}${EXCLUDE_PARAM_SEPARATOR}${encodeURIComponent(facet.value)}`,
      );
    }
    params.delete("col");
    for (const column of columns) {
      params.append("col", encodeURIComponent(column));
    }
    if (nextTimeMode === "rel") {
      params.set("tr", "rel");
      params.set("dur", requestedRelativeDuration);
      if (requestedRefresh !== "off") params.set("refresh", requestedRefresh);
      else params.delete("refresh");
      params.delete("from");
      params.delete("to");
      params.delete("shareAbs");
      params.delete("startTime");
      params.delete("endTime");
    } else {
      params.set("tr", "abs");
      if (requestedShareAbsoluteTime) {
        params.set("shareAbs", "1");
        if (startTime) params.set("from", startTime);
        else params.delete("from");
        if (endTime) params.set("to", endTime);
        else params.delete("to");
      } else {
        params.delete("shareAbs");
        params.delete("from");
        params.delete("to");
      }
      params.delete("dur");
      if (requestedRefresh !== "off") params.set("refresh", requestedRefresh);
      else params.delete("refresh");
      params.delete("startTime");
      params.delete("endTime");
      if (startTime && endTime) {
        const nextAbsoluteRange = { startTime, endTime };
        setLocalAbsoluteRange(nextAbsoluteRange);
        writeStoredAbsoluteRange(nextAbsoluteRange);
      }
    }
    if (level) params.set("level", level);
    else params.delete("level");
    if (service) params.set("service", service);
    else params.delete("service");
    if (host) params.set("host", host);
    else params.delete("host");
    if (sortBy !== DEFAULT_SORT.sortBy) params.set("sortBy", sortBy);
    else params.delete("sortBy");
    if (sortDirection !== DEFAULT_SORT.sortDirection) params.set("sortDirection", sortDirection);
    else params.delete("sortDirection");

    const queryString = params.toString();
    router.push(queryString ? `${pathname}?${queryString}` : pathname, { scroll: false });
  }

  return {
    currentQuery,
    currentMode,
    currentPageToken,
    currentViewId,
    currentPage,
    pageSize,
    currentFilters,
    currentSourceId,
    currentExclusions,
    currentFacetSelections,
    currentColumns,
    currentTimeRange,
    currentTimeMode,
    currentRelativeDuration,
    currentRefresh,
    currentShareAbsoluteTime,
    currentSort,
    currentDefinition,
    fallbackRange,
    updateSearch,
  };
}
