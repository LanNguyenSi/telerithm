"use client";

import { useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { SavedLogViewDefinition } from "@/types";

/* ── Constants ── */

export const DEFAULT_PAGE_SIZE = 50;
export const ALLOWED_PAGE_SIZES = [25, 50, 100];
export const DEFAULT_SORT = { sortBy: "timestamp" as const, sortDirection: "desc" as const };
export const DEFAULT_LOOKBACK_MS = 60 * 60 * 1000;
const EXCLUDE_PARAM_SEPARATOR = "::";

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
  level?: string;
  service?: string;
  host?: string;
  sortBy?: "timestamp" | "level" | "service" | "host";
  sortDirection?: "asc" | "desc";
}

/* ── Helpers ── */

function defaultTimeRange(): { startTime: string; endTime: string } {
  const end = new Date();
  const start = new Date(end.getTime() - DEFAULT_LOOKBACK_MS);
  return { startTime: start.toISOString(), endTime: end.toISOString() };
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

/* ── Hook ── */

export function useLogSearch() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [fallbackRange] = useState(() => defaultTimeRange());

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
  const currentTimeRange = {
    startTime: searchParams.get("startTime") ?? fallbackRange.startTime,
    endTime: searchParams.get("endTime") ?? fallbackRange.endTime,
  };
  const currentSort = {
    sortBy:
      (searchParams.get("sortBy") as "timestamp" | "level" | "service" | "host" | null) ??
      DEFAULT_SORT.sortBy,
    sortDirection: (searchParams.get("sortDirection") as "asc" | "desc" | null) ?? DEFAULT_SORT.sortDirection,
  };

  const currentDefinition = useMemo<SavedLogViewDefinition>(
    () => ({
      mode: currentMode,
      startTime: currentTimeRange.startTime,
      endTime: currentTimeRange.endTime,
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
    const startTime = next.startTime ?? currentTimeRange.startTime;
    const endTime = next.endTime ?? currentTimeRange.endTime;
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
    if (startTime) params.set("startTime", startTime);
    else params.delete("startTime");
    if (endTime) params.set("endTime", endTime);
    else params.delete("endTime");
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
    currentSort,
    currentDefinition,
    fallbackRange,
    updateSearch,
  };
}
