import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

afterEach(() => cleanup());
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { MetricCard } from "@/components/dashboard/metric-card";
import { LogTable } from "@/components/logs/log-table";
import { IncidentList } from "@/components/alerts/incident-list";

describe("Card", () => {
  it("renders children", () => {
    render(<Card>Test Content</Card>);
    expect(screen.getByText("Test Content")).toBeInTheDocument();
  });

  it("applies custom className", () => {
    const { container } = render(<Card className="test-class">Content</Card>);
    expect(container.firstChild).toHaveClass("test-class");
  });
});

describe("Badge", () => {
  it("renders with default neutral tone", () => {
    render(<Badge>Status</Badge>);
    expect(screen.getByText("Status")).toBeInTheDocument();
  });

  it("renders with danger tone", () => {
    const { container } = render(<Badge tone="danger">Error</Badge>);
    expect(container.firstChild).toHaveClass("bg-rose-100");
  });

  it("renders with signal tone", () => {
    const { container } = render(<Badge tone="signal">Info</Badge>);
    expect(container.firstChild).toHaveClass("bg-cyan-100");
  });

  it("renders with warning tone", () => {
    const { container } = render(<Badge tone="warning">Warn</Badge>);
    expect(container.firstChild).toHaveClass("bg-amber-100");
  });
});

describe("MetricCard", () => {
  it("renders label, value and hint", () => {
    render(<MetricCard label="Total Logs" value="1,234" hint="Sample data" />);
    expect(screen.getByText("Total Logs")).toBeInTheDocument();
    expect(screen.getByText("1,234")).toBeInTheDocument();
    expect(screen.getByText("Sample data")).toBeInTheDocument();
  });
});

describe("LogTable", () => {
  const logs = [
    {
      id: "1",
      teamId: "t1",
      sourceId: "s1",
      timestamp: "2024-06-15T10:30:00.000Z",
      level: "error" as const,
      service: "payment",
      host: "api-1",
      message: "Payment failed",
      fields: {},
    },
    {
      id: "2",
      teamId: "t1",
      sourceId: "s1",
      timestamp: "2024-06-15T10:31:00.000Z",
      level: "info" as const,
      service: "auth",
      host: "auth-1",
      message: "User logged in",
      fields: {},
    },
  ];

  it("renders table headers", () => {
    render(<LogTable logs={logs} />);
    expect(screen.getByText("Time")).toBeInTheDocument();
    expect(screen.getByText("Level")).toBeInTheDocument();
    expect(screen.getByText("Service")).toBeInTheDocument();
    expect(screen.getByText("Host")).toBeInTheDocument();
    expect(screen.getByText("Message")).toBeInTheDocument();
  });

  it("renders log entries", () => {
    render(<LogTable logs={logs} />);
    expect(screen.getAllByText("Payment failed").length).toBeGreaterThan(0);
    expect(screen.getAllByText("User logged in").length).toBeGreaterThan(0);
    expect(screen.getAllByText("payment").length).toBeGreaterThan(0);
    expect(screen.getAllByText("auth").length).toBeGreaterThan(0);
  });

  it("renders empty table without errors", () => {
    render(<LogTable logs={[]} />);
    expect(screen.getByText("Time")).toBeInTheDocument();
  });
});

describe("IncidentList", () => {
  const incidents = [
    {
      id: "i1",
      message: "Payment errors elevated",
      severity: "HIGH" as const,
      status: "OPEN" as const,
      createdAt: "2024-06-15T10:30:00.000Z",
    },
    {
      id: "i2",
      message: "Latency spike",
      severity: "MEDIUM" as const,
      status: "ACKNOWLEDGED" as const,
      createdAt: "2024-06-15T09:00:00.000Z",
    },
  ];

  it("renders heading", () => {
    render(<IncidentList incidents={incidents} />);
    expect(screen.getByText("Active Incidents")).toBeInTheDocument();
  });

  it("renders incident messages", () => {
    render(<IncidentList incidents={incidents} />);
    expect(screen.getByText("Payment errors elevated")).toBeInTheDocument();
    expect(screen.getByText("Latency spike")).toBeInTheDocument();
  });

  it("renders severity and status badges", () => {
    render(<IncidentList incidents={incidents} />);
    expect(screen.getByText("HIGH")).toBeInTheDocument();
    expect(screen.getByText("OPEN")).toBeInTheDocument();
    expect(screen.getByText("MEDIUM")).toBeInTheDocument();
    expect(screen.getByText("ACKNOWLEDGED")).toBeInTheDocument();
  });

  it("renders empty list without errors", () => {
    render(<IncidentList incidents={[]} />);
    expect(screen.getByText("Active Incidents")).toBeInTheDocument();
  });
});
