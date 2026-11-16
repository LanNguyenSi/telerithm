import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { LogEntry } from "@/types";

const mocks = vi.hoisted(() => ({ streamLogs: vi.fn(), createStreamTicket: vi.fn() }));

vi.mock("@/lib/api/client", () => ({
  BROWSER_SESSION: { via: "proxy" },
  streamLogs: mocks.streamLogs,
  createStreamTicket: mocks.createStreamTicket,
}));

import { LiveTail } from "@/components/logs/live-tail";
import { BROWSER_SESSION } from "@/lib/api/client";

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

type Listener = (event: { data: string }) => void;

class FakeSource {
  listeners: Record<string, Listener> = {};
  close = vi.fn();
  addEventListener(name: string, cb: Listener) {
    this.listeners[name] = cb;
  }
}

let sources: FakeSource[] = [];
let ticketCount = 0;

// Lets the debounce timer fire and the awaited ticket request settle.
async function settle(ms = 300) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  sources = [];
  ticketCount = 0;
  mocks.createStreamTicket.mockImplementation(async () => ({ ticket: `ticket-${++ticketCount}`, expiresInSeconds: 60 }));
  mocks.streamLogs.mockImplementation(() => {
    const source = new FakeSource();
    sources.push(source);
    return source;
  });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("LiveTail: message wrapping", () => {
  it("wraps the streamed message at word boundaries instead of breaking mid-word", async () => {
    render(<LiveTail teamId="t1" />);
    await settle();
    act(() => {
      sources[0].listeners["log:new"]({ data: JSON.stringify(log) });
    });

    const paragraph = screen.getByText(message);
    expect(paragraph.className).toContain("break-words");
    expect(paragraph.className).toContain("[overflow-wrap:anywhere]");
    expect(paragraph.className).not.toContain("break-all");
  });
});

describe("LiveTail: stream ticket", () => {
  it("fetches a ticket through the browser proxy for the team and opens the stream with it", async () => {
    render(<LiveTail teamId="t1" />);
    await settle();

    expect(mocks.createStreamTicket).toHaveBeenCalledExactlyOnceWith("t1", BROWSER_SESSION);
    expect(mocks.streamLogs).toHaveBeenCalledExactlyOnceWith("t1", "ticket-1", {
      level: undefined,
      service: undefined,
      host: undefined,
      query: undefined,
    });
  });

  it("asks for a ticket before it opens the stream, not after", async () => {
    const order: string[] = [];
    mocks.createStreamTicket.mockImplementation(async () => {
      order.push("ticket");
      return { ticket: "ticket-1", expiresInSeconds: 60 };
    });
    mocks.streamLogs.mockImplementation(() => {
      order.push("stream");
      return new FakeSource();
    });

    render(<LiveTail teamId="t1" />);
    await settle();

    expect(order).toEqual(["ticket", "stream"]);
  });

  it("shows Connected once the stream opens", async () => {
    render(<LiveTail teamId="t1" />);
    await settle();
    expect(screen.getByText("Waiting")).toBeTruthy();

    act(() => sources[0].listeners.open({ data: "" }));

    expect(screen.getByText("Connected")).toBeTruthy();
  });

  it("closes a failed stream and reconnects with a new ticket, since a ticket works once", async () => {
    render(<LiveTail teamId="t1" />);
    await settle();
    act(() => sources[0].listeners.open({ data: "" }));

    act(() => sources[0].listeners.error({ data: "" }));
    expect(sources[0].close).toHaveBeenCalled();
    expect(screen.getByText("Waiting")).toBeTruthy();
    await settle(1_000);

    expect(mocks.createStreamTicket).toHaveBeenCalledTimes(2);
    expect(mocks.streamLogs).toHaveBeenCalledTimes(2);
    expect(mocks.streamLogs.mock.calls[0][1]).toBe("ticket-1");
    expect(mocks.streamLogs.mock.calls[1][1]).toBe("ticket-2");
  });

  it("backs off between reconnects while the stream keeps failing, and starts over after it opens", async () => {
    render(<LiveTail teamId="t1" />);
    await settle();

    act(() => sources[0].listeners.error({ data: "" }));
    await settle(999);
    expect(mocks.streamLogs).toHaveBeenCalledTimes(1);
    await settle(1);
    expect(mocks.streamLogs).toHaveBeenCalledTimes(2);

    act(() => sources[1].listeners.error({ data: "" }));
    await settle(1_999);
    expect(mocks.streamLogs).toHaveBeenCalledTimes(2);
    await settle(1);
    expect(mocks.streamLogs).toHaveBeenCalledTimes(3);

    act(() => sources[2].listeners.open({ data: "" }));
    act(() => sources[2].listeners.error({ data: "" }));
    await settle(1_000);
    expect(mocks.streamLogs).toHaveBeenCalledTimes(4);
  });

  it("caps the pause between reconnects at 30 seconds", async () => {
    render(<LiveTail teamId="t1" />);
    await settle();

    // The pauses double 1, 2, 4, 8, 16 and then stay at 30 seconds: every
    // failure is followed by a new connection within 30 seconds.
    for (let failure = 1; failure <= 10; failure += 1) {
      act(() => sources[sources.length - 1].listeners.error({ data: "" }));
      await settle(30_000);
      expect(mocks.streamLogs).toHaveBeenCalledTimes(failure + 1);
    }
  });

  it("retries when the ticket request fails, without opening a stream", async () => {
    mocks.createStreamTicket.mockRejectedValueOnce(new Error("API request failed: 401"));

    render(<LiveTail teamId="t1" />);
    await settle();
    expect(mocks.streamLogs).not.toHaveBeenCalled();
    expect(screen.getByText("Waiting")).toBeTruthy();
    await settle(1_000);

    expect(mocks.createStreamTicket).toHaveBeenCalledTimes(2);
    expect(mocks.streamLogs).toHaveBeenCalledExactlyOnceWith("t1", "ticket-1", expect.anything());
  });

  it("reconnects with a new ticket and the new filters when a filter changes", async () => {
    render(<LiveTail teamId="t1" />);
    await settle();

    fireEvent.change(screen.getByPlaceholderText("level"), { target: { value: "error" } });
    await settle();

    expect(sources[0].close).toHaveBeenCalled();
    expect(mocks.createStreamTicket).toHaveBeenCalledTimes(2);
    expect(mocks.streamLogs.mock.calls[1]).toEqual(["t1", "ticket-2", expect.objectContaining({ level: "error" })]);
  });

  it("fetches one ticket for a burst of keystrokes in a filter", async () => {
    render(<LiveTail teamId="t1" />);
    await settle();
    mocks.createStreamTicket.mockClear();

    const input = screen.getByPlaceholderText("contains text");
    for (const value of ["t", "ti", "tim", "time"]) {
      fireEvent.change(input, { target: { value } });
      await settle(100);
    }
    await settle(300);

    expect(mocks.createStreamTicket).toHaveBeenCalledTimes(1);
    expect(mocks.streamLogs.mock.calls.at(-1)?.[2]).toEqual(expect.objectContaining({ query: "time" }));
  });

  it("does not connect while paused, and connects with a new ticket on resume", async () => {
    render(<LiveTail teamId="t1" />);
    await settle();

    fireEvent.click(screen.getByText("Pause stream"));
    await settle(60_000);
    expect(sources[0].close).toHaveBeenCalled();
    expect(mocks.createStreamTicket).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Paused")).toBeTruthy();

    fireEvent.click(screen.getByText("Resume stream"));
    await settle();
    expect(mocks.createStreamTicket).toHaveBeenCalledTimes(2);
    expect(mocks.streamLogs.mock.calls[1][1]).toBe("ticket-2");
  });

  it("opens no stream when it unmounts while the ticket is still being fetched", async () => {
    let resolveTicket: (value: { ticket: string; expiresInSeconds: number }) => void = () => {};
    mocks.createStreamTicket.mockImplementation(() => new Promise((resolve) => (resolveTicket = resolve)));

    const view = render(<LiveTail teamId="t1" />);
    await settle();
    view.unmount();
    await act(async () => {
      resolveTicket({ ticket: "late", expiresInSeconds: 60 });
    });

    expect(mocks.streamLogs).not.toHaveBeenCalled();
  });

  it("does not retry after it unmounts while a ticket request is failing", async () => {
    let rejectTicket: (reason: Error) => void = () => {};
    mocks.createStreamTicket.mockImplementation(() => new Promise((_resolve, reject) => (rejectTicket = reject)));

    const view = render(<LiveTail teamId="t1" />);
    await settle();
    view.unmount();
    await act(async () => {
      rejectTicket(new Error("API request failed: 502"));
    });
    await settle(60_000);

    expect(mocks.createStreamTicket).toHaveBeenCalledTimes(1);
    expect(mocks.streamLogs).not.toHaveBeenCalled();
  });

  it("stops reconnecting after it unmounts", async () => {
    const view = render(<LiveTail teamId="t1" />);
    await settle();
    act(() => sources[0].listeners.error({ data: "" }));

    view.unmount();
    await settle(60_000);

    expect(mocks.streamLogs).toHaveBeenCalledTimes(1);
  });

  it("closes the open stream when it unmounts", async () => {
    const view = render(<LiveTail teamId="t1" />);
    await settle();

    view.unmount();

    expect(sources[0].close).toHaveBeenCalled();
  });
});
