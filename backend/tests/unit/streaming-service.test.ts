import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Response } from "express";

const { inc, dec } = vi.hoisted(() => ({ inc: vi.fn(), dec: vi.fn() }));

vi.mock("../../src/metrics/index.js", () => ({ activeConnections: { inc, dec } }));

import { StreamingService } from "../../src/services/streaming/streaming-service.js";

function fakeRes() {
  return {
    setHeader: vi.fn(),
    flushHeaders: vi.fn(),
    write: vi.fn(),
    end: vi.fn(),
  };
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
