import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import type { LogEntry } from "@/types";

const mocks = vi.hoisted(() => ({ streamLogs: vi.fn() }));

vi.mock("@/lib/api/client", () => ({ streamLogs: mocks.streamLogs }));

import { LiveTail } from "@/components/logs/live-tail";

const message =
  "Slow query detected: SELECT * FROM orders WHERE customer_id = $1 ORDER BY created_at DESC LIMIT 500 - consider adding an index";

const log: LogEntry = {
  id: "live-1",
  teamId: "t1",
  sourceId: "s1",
  timestamp: "2026-04-02T10:30:00.000Z",
  level: "warn",
  service: "payment",
  host: "api-1",
  message,
  fields: {},
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("LiveTail: message wrapping", () => {
  it("wraps the streamed message at word boundaries instead of breaking mid-word", () => {
    const listeners: Record<string, (event: { data: string }) => void> = {};
    mocks.streamLogs.mockReturnValue({
      addEventListener: (name: string, cb: (event: { data: string }) => void) => {
        listeners[name] = cb;
      },
      close: vi.fn(),
    });
    render(<LiveTail teamId="t1" token="tok" />);
    act(() => {
      listeners["log:new"]({ data: JSON.stringify(log) });
    });

    const paragraph = screen.getByText(message);
    expect(paragraph.className).toContain("break-words");
    expect(paragraph.className).toContain("[overflow-wrap:anywhere]");
    expect(paragraph.className).not.toContain("break-all");
  });
});
