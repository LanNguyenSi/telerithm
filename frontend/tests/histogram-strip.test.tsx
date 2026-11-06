import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { HistogramStrip } from "@/components/logs/histogram-strip";
import type { LogHistogramBucket } from "@/types";

afterEach(() => cleanup());

const buckets: LogHistogramBucket[] = [
  { start: "2026-11-06T10:00:00.000Z", end: "2026-11-06T10:05:00.000Z", count: 12 },
  { start: "2026-11-06T10:05:00.000Z", end: "2026-11-06T10:10:00.000Z", count: 3 },
];

describe("HistogramStrip bars", () => {
  it("names each bucket button with its start time and count", () => {
    render(<HistogramStrip buckets={buckets} loading={false} onSelectBucket={vi.fn()} />);
    const start = new Date(buckets[0].start).toLocaleString("de-DE");
    const button = screen.getByRole("button", { name: `${start}: 12 events` });
    expect(button.getAttribute("title")).toBe(`${start} - 12`);
    expect(screen.getByRole("button", { name: /: 3 events$/ })).toBeTruthy();
  });

  it("draws the bars with a visible fill in both schemes", () => {
    render(<HistogramStrip buckets={buckets} loading={false} onSelectBucket={vi.fn()} />);
    for (const button of screen.getAllByRole("button")) {
      const bar = button.querySelector("span") as HTMLElement;
      expect(bar.className).toContain("bg-slate-500");
      expect(bar.className).toContain("dark:bg-slate-400");
      expect(bar.className).toContain("group-hover:bg-signal");
      expect(bar.className).not.toMatch(/(^|\s)bg-line(\s|$)/);
    }
  });

  it("calls onSelectBucket with the clicked bucket", () => {
    const onSelectBucket = vi.fn();
    render(<HistogramStrip buckets={buckets} loading={false} onSelectBucket={onSelectBucket} />);
    fireEvent.click(screen.getAllByRole("button")[1]);
    expect(onSelectBucket).toHaveBeenCalledTimes(1);
    expect(onSelectBucket).toHaveBeenCalledWith(buckets[1]);
  });
});
