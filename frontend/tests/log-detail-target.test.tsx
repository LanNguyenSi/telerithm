import { afterEach, describe, expect, it, vi } from "vitest";
import { Suspense } from "react";
import { act, cleanup, render, screen } from "@testing-library/react";

const mocks = vi.hoisted(() => ({
  getLogById: vi.fn(),
  getLogContext: vi.fn(),
}));

vi.mock("@/lib/api/client", () => ({
  getLogById: mocks.getLogById,
  getLogContext: mocks.getLogContext,
}));
vi.mock("@/components/logs/log-auth-context", () => ({
  useLogAuth: () => ({ team: { id: "team-1" }, token: "tok" }),
}));

import { LogDetailScreen } from "@/app/(dashboard)/logs/[id]/screen";
import type { LogEntry } from "@/types";

const log: LogEntry = {
  id: "l1",
  teamId: "team-1",
  sourceId: "s1",
  timestamp: "2026-04-02T10:30:00.000Z",
  level: "error",
  service: "payment",
  host: "api-1",
  message: "Payment failed",
  fields: { requestId: "req-123" },
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("LogDetailScreen: filter link target size (WCAG 2.5.8)", () => {
  it("gives the filter link min-h-6 and min-w-6 sizing classes", async () => {
    mocks.getLogById.mockResolvedValue({ log });
    mocks.getLogContext.mockResolvedValue({ before: [], after: [] });

    await act(async () => {
      render(
        <Suspense fallback={null}>
          <LogDetailScreen paramsPromise={Promise.resolve({ id: "l1" })} />
        </Suspense>,
      );
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    const link = await screen.findByRole("link", { name: "filter" });
    expect(link.className).toContain("min-h-6");
    expect(link.className).toContain("min-w-6");
  });
});
