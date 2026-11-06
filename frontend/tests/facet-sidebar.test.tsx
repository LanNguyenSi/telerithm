import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { FacetSidebar } from "@/components/logs/facet-sidebar";
import type { LogFacet } from "@/types";

afterEach(() => cleanup());

const facets: LogFacet[] = [
  {
    field: "service",
    buckets: [
      { value: "api-gateway", count: 12 },
      { value: "checkout", count: 3 },
    ],
  },
];

describe("FacetSidebar — chip target size (WCAG 2.5.8)", () => {
  it("gives every facet chip the min-h-6 sizing class", () => {
    render(
      <FacetSidebar facets={facets} active={[]} loading={false} onToggle={vi.fn()} />,
    );
    const buttons = screen.getAllByRole("button");
    expect(buttons).toHaveLength(2);
    for (const button of buttons) {
      expect(button.className).toContain("min-h-6");
    }
  });

  it("keeps the min-h-6 sizing class on the active chip", () => {
    render(
      <FacetSidebar
        facets={facets}
        active={[{ field: "service", value: "api-gateway" }]}
        loading={false}
        onToggle={vi.fn()}
      />,
    );
    for (const button of screen.getAllByRole("button")) {
      expect(button.className).toContain("min-h-6");
    }
  });
});
