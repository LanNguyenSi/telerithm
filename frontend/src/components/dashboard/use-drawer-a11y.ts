"use client";

import { useEffect, useRef, type RefObject } from "react";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function focusableIn(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE));
}

interface DrawerA11yOptions {
  open: boolean;
  onClose: () => void;
  /** The drawer element; rendered only while `open` is true. */
  containerRef: RefObject<HTMLElement | null>;
  /** The control that opened the drawer; receives focus again on close. */
  returnFocusRef: RefObject<HTMLElement | null>;
  /**
   * Set to true by the caller right before closing because of a navigation.
   * Focus then is not returned to the toggle: the clicked link is gone and the
   * navigation decides where focus goes.
   */
  skipFocusReturnRef: RefObject<boolean>;
  /**
   * Returns the elements that sit outside the drawer and its overlay (top bar,
   * desktop sidebar, page content). They carry `inert` while the drawer is open,
   * so neither keyboard focus nor assistive technology reaches them. Missing
   * entries (null) are skipped. Read when the drawer opens.
   */
  getInertTargets?: () => ReadonlyArray<HTMLElement | null>;
}

/**
 * Keyboard and focus behaviour of a modal drawer: focus moves into the drawer
 * when it opens, Tab and Shift+Tab wrap inside it, Escape closes it, and focus
 * goes back to the opening control when it closes. The page behind the drawer
 * is made `inert` while it is open. The effect only runs while `open` is true,
 * so a closed drawer leaves no listener behind.
 */
export function useDrawerA11y({
  open,
  onClose,
  containerRef,
  returnFocusRef,
  skipFocusReturnRef,
  getInertTargets,
}: DrawerA11yOptions) {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const getInertTargetsRef = useRef(getInertTargets);
  getInertTargetsRef.current = getInertTargets;

  useEffect(() => {
    if (!open) return;
    const container = containerRef.current;
    if (!container) return;

    // Only elements that were not inert already are marked, so only those are
    // released again on close.
    const madeInert: HTMLElement[] = [];
    for (const el of getInertTargetsRef.current?.() ?? []) {
      if (el && !el.hasAttribute("inert")) {
        el.setAttribute("inert", "");
        madeInert.push(el);
      }
    }

    // Runs after React committed the drawer, so the target exists in the DOM.
    (focusableIn(container)[0] ?? container).focus();

    function handleKey(e: KeyboardEvent) {
      if (!container) return;
      if (e.key === "Escape") {
        e.preventDefault();
        onCloseRef.current();
        return;
      }
      if (e.key !== "Tab") return;
      const items = focusableIn(container);
      if (items.length === 0) {
        e.preventDefault();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (!container.contains(active)) {
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
      } else if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("keydown", handleKey);
      // Before focus goes back: an inert element (the toggle) cannot take focus.
      for (const el of madeInert) el.removeAttribute("inert");
      if (skipFocusReturnRef.current) {
        skipFocusReturnRef.current = false;
      } else {
        returnFocusRef.current?.focus();
      }
    };
  }, [open, containerRef, returnFocusRef, skipFocusReturnRef]);
}
