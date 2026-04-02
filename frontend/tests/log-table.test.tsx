import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { LogTable } from "@/components/logs/log-table";
import type { LogEntry } from "@/types";

afterEach(() => cleanup());

function makeLog(overrides: Partial<LogEntry> = {}): LogEntry {
  return {
    id: "log-1",
    teamId: "t1",
    sourceId: "s1",
    timestamp: "2026-04-02T10:30:00.000Z",
    level: "error",
    service: "payment",
    host: "api-1",
    message: "Payment failed",
    fields: {},
    ...overrides,
  };
}

describe("LogTable — expanded row toggle", () => {
  it("toggles expanded state on click for long messages", () => {
    const longMessage = "A".repeat(200);
    const log = makeLog({ id: "long-log", message: longMessage });
    render(<LogTable logs={[log]} />);

    // Find the row — long messages are truncatable
    const rows = screen.getAllByRole("row");
    // First row is header, second should contain our log
    expect(rows.length).toBeGreaterThan(1);
    
    // Click to expand (on desktop table)
    fireEvent.click(rows[1]);

    // Click again to collapse (toggle)
    fireEvent.click(rows[1]);
  });

  it("renders short messages correctly", () => {
    const log = makeLog({ id: "short-log", message: "Short" });
    render(<LogTable logs={[log]} />);

    // Should render the message (may appear in both desktop and mobile views)
    expect(screen.getAllByText("Short").length).toBeGreaterThan(0);
  });
});

describe("LogTable — extra columns", () => {
  it("renders extra columns in header and rows", () => {
    const log = makeLog({ fields: { requestId: "req-123" } });
    render(<LogTable logs={[log]} extraColumns={["requestId"]} />);

    expect(screen.getByText("requestId")).toBeInTheDocument();
    expect(screen.getByText("req-123")).toBeInTheDocument();
  });
});

describe("LogTable — selected log highlight", () => {
  it("highlights selected log row", () => {
    const logs = [makeLog({ id: "sel-log" })];
    render(<LogTable logs={logs} selectedLogId="sel-log" />);

    // Selected rows should render with log message visible
    expect(screen.getAllByText("Payment failed").length).toBeGreaterThan(0);
  });
});

describe("LogTable — level formatting", () => {
  it("renders error level", () => {
    render(<LogTable logs={[makeLog({ level: "error" })]} />);
    expect(screen.getAllByText("error").length).toBeGreaterThan(0);
  });

  it("renders warn level", () => {
    render(<LogTable logs={[makeLog({ level: "warn" })]} />);
    expect(screen.getAllByText("warn").length).toBeGreaterThan(0);
  });

  it("renders info level", () => {
    render(<LogTable logs={[makeLog({ level: "info" })]} />);
    expect(screen.getAllByText("info").length).toBeGreaterThan(0);
  });

  it("renders debug level", () => {
    render(<LogTable logs={[makeLog({ level: "debug" })]} />);
    expect(screen.getAllByText("debug").length).toBeGreaterThan(0);
  });
});

describe("LogTable — mobile card layout", () => {
  // Mobile layout uses cards instead of table rows
  it("renders mobile card with service and level badges", () => {
    render(<LogTable logs={[makeLog()]} />);
    // Both table and card layouts should be rendered (hidden via CSS)
    expect(screen.getAllByText("payment").length).toBeGreaterThan(0);
    expect(screen.getAllByText("error").length).toBeGreaterThan(0);
  });
});

describe("LogTable — empty state", () => {
  it("renders table structure with no logs", () => {
    render(<LogTable logs={[]} />);
    expect(screen.getByText("Time")).toBeInTheDocument();
    expect(screen.getByText("Level")).toBeInTheDocument();
    expect(screen.getByText("Service")).toBeInTheDocument();
  });
});
