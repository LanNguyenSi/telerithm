"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Tab stop for a horizontally scrollable region, only while it overflows.
 *
 * A scroll container has to be reachable by keyboard (axe
 * `scrollable-region-focusable`), but a region whose content fits has nothing to
 * scroll, so `tabIndex={0}` there is a tab stop that goes nowhere. This hook
 * measures `scrollWidth > clientWidth` and returns `0` only while that holds,
 * `undefined` otherwise (React drops an `undefined` attribute).
 *
 * Measurement: once when the node is attached, again whenever `reviewKey`
 * changes (extra columns or a different page of rows widen the table without
 * resizing the region, which ResizeObserver alone would not notice), and again
 * on every resize of the region itself. `reviewKey` is a string the caller
 * rebuilds from the content that could change the width.
 *
 * Where `ResizeObserver` is missing (older browsers, some test environments)
 * the initial measure plus `reviewKey` are all the measurement there is, and
 * nothing throws.
 */
export function useOverflowTabindex(reviewKey?: string): {
  ref: (node: HTMLElement | null) => void;
  tabIndex: 0 | undefined;
} {
  const [node, setNode] = useState<HTMLElement | null>(null);
  const [overflows, setOverflows] = useState(false);

  const ref = useCallback((el: HTMLElement | null) => {
    setNode(el);
  }, []);

  useEffect(() => {
    if (!node) return;
    const region = node;

    function measure() {
      setOverflows(region.scrollWidth > region.clientWidth);
    }

    measure();

    if (typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver(measure);
    observer.observe(region);

    return () => {
      observer.disconnect();
    };
  }, [node, reviewKey]);

  return { ref, tabIndex: overflows ? 0 : undefined };
}
