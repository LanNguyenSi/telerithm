import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Response } from "express";

const { inc, dec } = vi.hoisted(() => ({ inc: vi.fn(), dec: vi.fn() }));

vi.mock("../../src/metrics/index.js", () => ({ activeConnections: { inc, dec } }));

import { StreamingService } from "../../src/services/streaming/streaming-service.js";

// An EventEmitter, so a test can emit the `close` and `error` a real response emits.
function fakeRes() {
  return Object.assign(new EventEmitter(), {
    setHeader: vi.fn(),
    flushHeaders: vi.fn(),
    write: vi.fn(),
    end: vi.fn(),
  });
}

const asRes = (res: ReturnType<typeof fakeRes>) => res as unknown as Response;
const pings = (res: ReturnType<typeof fakeRes>) =>
  res.write.mock.calls.filter(([chunk]) => String(chunk) === "event: ping\n").length;

describe("StreamingService heartbeat re-validation", () => {
  let events: EventEmitter;
  let service: StreamingService;

  beforeEach(() => {
    vi.useFakeTimers();
    inc.mockClear();
    dec.mockClear();
    events = new EventEmitter();
    service = new StreamingService(events);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps streaming and pings while the check keeps passing", async () => {
    const res = fakeRes();
    const revalidate = vi.fn().mockResolvedValue(true);
    service.subscribe("t1", asRes(res), undefined, revalidate);

    await vi.advanceTimersByTimeAsync(15000);
    await vi.advanceTimersByTimeAsync(15000);

    expect(revalidate).toHaveBeenCalledTimes(2);
    expect(pings(res)).toBe(2);
    expect(res.end).not.toHaveBeenCalled();
    events.emit("log:new", { teamId: "t1", message: "m", service: "s", host: "h" });
    expect(res.write).toHaveBeenCalledWith("event: log:new\n");
  });

  it("ends the stream at the next heartbeat once the check fails, and stops delivering logs", async () => {
    const res = fakeRes();
    const revalidate = vi.fn().mockResolvedValueOnce(true).mockResolvedValue(false);
    service.subscribe("t1", asRes(res), undefined, revalidate);

    await vi.advanceTimersByTimeAsync(15000);
    expect(res.end).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(15000);

    expect(res.end).toHaveBeenCalledTimes(1);
    expect(dec).toHaveBeenCalledTimes(1);
    expect(pings(res)).toBe(1);
    events.emit("log:new", { teamId: "t1", message: "m", service: "s", host: "h" });
    expect(res.write).not.toHaveBeenCalledWith("event: log:new\n");
    await vi.advanceTimersByTimeAsync(60000);
    expect(revalidate).toHaveBeenCalledTimes(2);
  });

  it("does not end before the first heartbeat", async () => {
    const res = fakeRes();
    service.subscribe("t1", asRes(res), undefined, vi.fn().mockResolvedValue(false));

    await vi.advanceTimersByTimeAsync(14999);

    expect(res.end).not.toHaveBeenCalled();
  });

  it("keeps the stream when the check itself fails (not a verdict) and tries again at the next beat", async () => {
    const res = fakeRes();
    const revalidate = vi.fn().mockRejectedValueOnce(new Error("db down")).mockResolvedValue(false);
    service.subscribe("t1", asRes(res), undefined, revalidate);

    await vi.advanceTimersByTimeAsync(15000);
    expect(res.end).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(15000);

    expect(res.end).toHaveBeenCalledTimes(1);
  });

  it("closes once even when the client disconnect and a failed check both close it", async () => {
    const res = fakeRes();
    const close = service.subscribe("t1", asRes(res), undefined, vi.fn().mockResolvedValue(false));

    await vi.advanceTimersByTimeAsync(15000);
    close();

    expect(res.end).toHaveBeenCalledTimes(1);
    expect(dec).toHaveBeenCalledTimes(1);
  });

  it("writes no ping and ends once when the stream is closed while the check is pending and then passes", async () => {
    const res = fakeRes();
    let resolveCheck!: (allowed: boolean) => void;
    const revalidate = vi.fn(() => new Promise<boolean>((resolve) => (resolveCheck = resolve)));
    const close = service.subscribe("t1", asRes(res), undefined, revalidate);

    await vi.advanceTimersByTimeAsync(15000);
    expect(revalidate).toHaveBeenCalledTimes(1);
    close();
    resolveCheck(true);
    await vi.advanceTimersByTimeAsync(0);

    expect(pings(res)).toBe(0);
    expect(res.end).toHaveBeenCalledTimes(1);
    expect(dec).toHaveBeenCalledTimes(1);
  });

  it("writes no ping and ends once when the stream is closed while the check is pending and then fails", async () => {
    const res = fakeRes();
    let rejectCheck!: (error: Error) => void;
    const revalidate = vi.fn(() => new Promise<boolean>((_resolve, reject) => (rejectCheck = reject)));
    const close = service.subscribe("t1", asRes(res), undefined, revalidate);

    await vi.advanceTimersByTimeAsync(15000);
    expect(revalidate).toHaveBeenCalledTimes(1);
    close();
    rejectCheck(new Error("db down"));
    await vi.advanceTimersByTimeAsync(0);

    expect(pings(res)).toBe(0);
    expect(res.end).toHaveBeenCalledTimes(1);
    expect(dec).toHaveBeenCalledTimes(1);
  });

  it("without a check it only pings", async () => {
    const res = fakeRes();
    service.subscribe("t1", asRes(res));

    await vi.advanceTimersByTimeAsync(30000);

    expect(pings(res)).toBe(2);
    expect(res.end).not.toHaveBeenCalled();
  });
});

describe("StreamingService per-user stream cap", () => {
  let events: EventEmitter;
  let service: StreamingService;

  beforeEach(() => {
    vi.useFakeTimers();
    inc.mockClear();
    dec.mockClear();
    events = new EventEmitter();
    service = new StreamingService(events);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const open = (userId: string, max: number, res = fakeRes()) =>
    service.subscribe("t1", asRes(res), undefined, undefined, { userId, max });

  it("takes a slot per open stream and counts per user", () => {
    open("u1", 5);
    open("u1", 5);
    open("u2", 5);

    expect(service.activeStreamsFor("u1")).toBe(2);
    expect(service.activeStreamsFor("u2")).toBe(1);
    expect(service.activeStreamsFor("nobody")).toBe(0);
  });

  it("answers null at the cap and writes nothing to the response", () => {
    open("u1", 2);
    open("u1", 2);
    const res = fakeRes();

    const refused = open("u1", 2, res);

    expect(refused).toBeNull();
    expect(res.setHeader).not.toHaveBeenCalled();
    expect(res.flushHeaders).not.toHaveBeenCalled();
    expect(res.end).not.toHaveBeenCalled();
    expect(inc).toHaveBeenCalledTimes(2);
    expect(events.listenerCount("log:new")).toBe(2);
    expect(service.activeStreamsFor("u1")).toBe(2);
  });

  it("does not let one user's streams count against another user", () => {
    open("u1", 1);

    expect(open("u1", 1)).toBeNull();
    expect(open("u2", 1)).not.toBeNull();
  });

  it("falls back to a cap of 5 when the caller passes none", () => {
    const attempt = () => service.subscribe("t1", asRes(fakeRes()), undefined, undefined, { userId: "u1" });
    for (let i = 0; i < 5; i++) expect(attempt()).not.toBeNull();

    expect(attempt()).toBeNull();
  });

  it("leaves a stream without a limit uncounted", () => {
    for (let i = 0; i < 8; i++) service.subscribe("t1", asRes(fakeRes()));

    expect(service.activeStreamsFor("u1")).toBe(0);
  });

  it("gives the slot back when the stream is closed, so a new one opens", () => {
    const first = open("u1", 1)!;
    expect(open("u1", 1)).toBeNull();

    first();

    expect(service.activeStreamsFor("u1")).toBe(0);
    expect(open("u1", 1)).not.toBeNull();
  });

  it("releases once: closing twice does not free a second slot", () => {
    const first = open("u1", 3)!;
    open("u1", 3);
    open("u1", 3);

    first();
    first();

    expect(service.activeStreamsFor("u1")).toBe(2);
    expect(open("u1", 3)).not.toBeNull();
    expect(open("u1", 3)).toBeNull();
  });

  it("deletes the user's entry when the last stream closes, so ids do not pile up", () => {
    const close = open("u1", 5)!;
    expect(service["streamsByUser"].size).toBe(1);

    close();

    expect(service["streamsByUser"].size).toBe(0);
  });

  it("releases the slot when the response closes (client left)", () => {
    const res = fakeRes();
    open("u1", 1, res);

    res.emit("close");

    expect(service.activeStreamsFor("u1")).toBe(0);
    expect(dec).toHaveBeenCalledTimes(1);
    expect(events.listenerCount("log:new")).toBe(0);
  });

  it("releases the slot when the response fails", () => {
    const res = fakeRes();
    open("u1", 1, res);

    res.emit("error", new Error("socket hang up"));

    expect(service.activeStreamsFor("u1")).toBe(0);
    expect(dec).toHaveBeenCalledTimes(1);
  });

  it("releases the slot when the check ends the stream", async () => {
    const res = fakeRes();
    service.subscribe("t1", asRes(res), undefined, vi.fn().mockResolvedValue(false), {
      userId: "u1",
      max: 1,
    });

    await vi.advanceTimersByTimeAsync(15000);

    expect(res.end).toHaveBeenCalledTimes(1);
    expect(service.activeStreamsFor("u1")).toBe(0);
  });

  it("releases the slot and rethrows when writing the headers throws", () => {
    const res = fakeRes();
    res.flushHeaders.mockImplementation(() => {
      throw new Error("write after end");
    });

    expect(() => open("u1", 1, res)).toThrow("write after end");

    expect(service.activeStreamsFor("u1")).toBe(0);
    expect(inc).not.toHaveBeenCalled();
    expect(events.listenerCount("log:new")).toBe(0);
  });

  describe("a response that is already gone when the stream is subscribed", () => {
    it.each([["destroyed"], ["closed"], ["writableEnded"]])(
      "subscribes nothing and takes no slot when res.%s is true",
      (flag) => {
        const res = Object.assign(fakeRes(), { [flag]: true });

        const close = open("u1", 1, res);

        expect(close).toBeTypeOf("function");
        expect(res.setHeader).not.toHaveBeenCalled();
        expect(inc).not.toHaveBeenCalled();
        expect(events.listenerCount("log:new")).toBe(0);
        expect(res.listenerCount("close")).toBe(0);
        expect(vi.getTimerCount()).toBe(0);
        expect(service.activeStreamsFor("u1")).toBe(0);
        expect(() => close!()).not.toThrow();
        expect(dec).not.toHaveBeenCalled();
      },
    );

    it("does not count a gone response against a user at the cap", () => {
      open("u1", 1);

      expect(open("u1", 1, Object.assign(fakeRes(), { destroyed: true }))).not.toBeNull();
      expect(service.activeStreamsFor("u1")).toBe(1);
    });
  });
});
