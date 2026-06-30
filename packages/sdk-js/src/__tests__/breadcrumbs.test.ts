import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { BreadcrumbTracker } from "../integrations/breadcrumbs.js";

describe("BreadcrumbTracker", () => {
  let tracker: BreadcrumbTracker;

  beforeEach(() => {
    tracker = new BreadcrumbTracker(3);
  });

  afterEach(() => {
    tracker.teardown();
  });

  it("stores added breadcrumbs with a timestamp", () => {
    tracker.add({ category: "test", message: "hello" });
    const crumbs = tracker.getAll();
    expect(crumbs).toHaveLength(1);
    expect(crumbs[0].category).toBe("test");
    expect(crumbs[0].message).toBe("hello");
    expect(typeof crumbs[0].timestamp).toBe("string");
  });

  it("shifts out the oldest crumb when maxCrumbs is exceeded (ring-buffer)", () => {
    tracker.add({ category: "a", message: "first" });
    tracker.add({ category: "b", message: "second" });
    tracker.add({ category: "c", message: "third" });
    tracker.add({ category: "d", message: "fourth" }); // exceeds maxCrumbs=3

    const crumbs = tracker.getAll();
    expect(crumbs).toHaveLength(3);
    expect(crumbs[0].message).toBe("second"); // first was dropped
    expect(crumbs[1].message).toBe("third");
    expect(crumbs[2].message).toBe("fourth");
  });

  it("getAll returns a copy — mutations to the returned ARRAY do not affect internal state", () => {
    tracker.add({ category: "a", message: "first" });
    tracker.add({ category: "b", message: "second" });
    const snapshot = tracker.getAll();

    // Truncate the returned array — internal state must be unchanged
    snapshot.length = 0;

    expect(tracker.getAll()).toHaveLength(2);
  });

  it("instrumentConsole captures console.warn as a warn-level breadcrumb", () => {
    tracker.instrumentConsole();
    console.warn("watch out");
    const crumbs = tracker.getAll();
    const warnCrumb = crumbs.find((c) => c.level === "warn");
    expect(warnCrumb).toBeDefined();
    expect(warnCrumb!.message).toContain("watch out");
    expect(warnCrumb!.category).toBe("console");
  });

  it("instrumentConsole captures console.error as an error-level breadcrumb", () => {
    tracker.instrumentConsole();
    console.error("something broke");
    const crumbs = tracker.getAll();
    const errorCrumb = crumbs.find((c) => c.level === "error");
    expect(errorCrumb).toBeDefined();
    expect(errorCrumb!.message).toContain("something broke");
    expect(errorCrumb!.category).toBe("console");
  });

  it("teardown restores original console.warn and console.error", () => {
    const origWarn = console.warn;
    const origError = console.error;

    tracker.instrumentConsole();
    expect(console.warn).not.toBe(origWarn);
    expect(console.error).not.toBe(origError);

    tracker.teardown();
    expect(console.warn).toBe(origWarn);
    expect(console.error).toBe(origError);
  });

  it("clear() empties the breadcrumb list", () => {
    tracker.add({ category: "x", message: "y" });
    tracker.clear();
    expect(tracker.getAll()).toHaveLength(0);
  });

  it("defaults maxCrumbs to 20", () => {
    const defaultTracker = new BreadcrumbTracker();
    for (let i = 0; i < 21; i++) {
      defaultTracker.add({ category: "x", message: `msg-${i}` });
    }
    const crumbs = defaultTracker.getAll();
    expect(crumbs).toHaveLength(20);
    expect(crumbs[0].message).toBe("msg-1"); // msg-0 was dropped
    defaultTracker.teardown();
  });

  it("stores optional level and data fields on breadcrumbs", () => {
    tracker.add({ category: "http", message: "GET /api", level: "info", data: { status: 200 } });
    const crumbs = tracker.getAll();
    expect(crumbs[0].level).toBe("info");
    expect(crumbs[0].data).toEqual({ status: 200 });
  });
});
