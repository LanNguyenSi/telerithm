import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { setupGlobalErrorHandlers } from "../integrations/global-error.js";
import type { TelerithmClient } from "../client.js";

function makeMockClient(): TelerithmClient {
  return { captureError: vi.fn() } as unknown as TelerithmClient;
}

describe("setupGlobalErrorHandlers — Node path", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("registers an uncaughtException listener on process", () => {
    const initial = process.listenerCount("uncaughtException");
    const client = makeMockClient();
    const cleanup = setupGlobalErrorHandlers(client);

    expect(process.listenerCount("uncaughtException")).toBe(initial + 1);
    cleanup();
  });

  it("registers an unhandledRejection listener on process", () => {
    const initial = process.listenerCount("unhandledRejection");
    const client = makeMockClient();
    const cleanup = setupGlobalErrorHandlers(client);

    expect(process.listenerCount("unhandledRejection")).toBe(initial + 1);
    cleanup();
  });

  it("uncaughtException listener calls captureError with the Error", () => {
    const client = makeMockClient();
    const cleanup = setupGlobalErrorHandlers(client);

    const err = new Error("uncaught!");
    const handlers = process.listeners("uncaughtException") as Array<(e: Error) => void>;
    handlers[handlers.length - 1](err);

    expect(client.captureError).toHaveBeenCalledWith(err, { type: "uncaughtException" });
    cleanup();
  });

  it("unhandledRejection listener calls captureError with an Error reason", () => {
    const client = makeMockClient();
    const cleanup = setupGlobalErrorHandlers(client);

    const err = new Error("unhandled rejection");
    const handlers = process.listeners("unhandledRejection") as Array<(r: unknown) => void>;
    handlers[handlers.length - 1](err);

    expect(client.captureError).toHaveBeenCalledWith(err, { type: "unhandledRejection" });
    cleanup();
  });

  it("unhandledRejection listener wraps a non-Error reason in a new Error", () => {
    const client = makeMockClient();
    const cleanup = setupGlobalErrorHandlers(client);

    const handlers = process.listeners("unhandledRejection") as Array<(r: unknown) => void>;
    handlers[handlers.length - 1]("string reason");

    const capturedErr = (client.captureError as ReturnType<typeof vi.fn>).mock.calls[0][0] as Error;
    expect(capturedErr).toBeInstanceOf(Error);
    expect(capturedErr.message).toBe("string reason");
    cleanup();
  });

  it("cleanup removes both Node listeners (listenerCount returns to baseline)", () => {
    const initialUncaught = process.listenerCount("uncaughtException");
    const initialUnhandled = process.listenerCount("unhandledRejection");

    const client = makeMockClient();
    const cleanup = setupGlobalErrorHandlers(client);
    cleanup();

    expect(process.listenerCount("uncaughtException")).toBe(initialUncaught);
    expect(process.listenerCount("unhandledRejection")).toBe(initialUnhandled);
  });
});

describe("setupGlobalErrorHandlers — browser path", () => {
  let mockAddEventListener: ReturnType<typeof vi.fn>;
  let mockRemoveEventListener: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockAddEventListener = vi.fn();
    mockRemoveEventListener = vi.fn();
    vi.stubGlobal("window", {
      addEventListener: mockAddEventListener,
      removeEventListener: mockRemoveEventListener,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("registers error and unhandledrejection handlers on window", () => {
    const client = makeMockClient();
    const cleanup = setupGlobalErrorHandlers(client);

    expect(mockAddEventListener).toHaveBeenCalledWith("error", expect.any(Function));
    expect(mockAddEventListener).toHaveBeenCalledWith("unhandledrejection", expect.any(Function));
    cleanup();
  });

  it("error handler calls captureError with event.error when present", () => {
    const client = makeMockClient();
    const cleanup = setupGlobalErrorHandlers(client);

    const errorHandler = mockAddEventListener.mock.calls.find(
      (call: unknown[]) => call[0] === "error",
    )![1] as (ev: ErrorEvent) => void;
    const err = new Error("window error");
    errorHandler({ error: err, filename: "app.js", lineno: 10, colno: 5 } as ErrorEvent);

    expect(client.captureError).toHaveBeenCalledWith(err, {
      source: "app.js",
      lineno: 10,
      colno: 5,
    });
    cleanup();
  });

  it("error handler falls back to new Error(event.message) when event.error is null/undefined", () => {
    const client = makeMockClient();
    const cleanup = setupGlobalErrorHandlers(client);

    const errorHandler = mockAddEventListener.mock.calls.find(
      (call: unknown[]) => call[0] === "error",
    )![1] as (ev: Partial<ErrorEvent>) => void;
    errorHandler({ error: null, message: "fallback message", filename: "", lineno: 0, colno: 0 });

    const captured = (client.captureError as ReturnType<typeof vi.fn>).mock.calls[0][0] as Error;
    expect(captured).toBeInstanceOf(Error);
    expect(captured.message).toBe("fallback message");
    cleanup();
  });

  it("unhandledrejection handler calls captureError with Error reason", () => {
    const client = makeMockClient();
    const cleanup = setupGlobalErrorHandlers(client);

    const rejectionHandler = mockAddEventListener.mock.calls.find(
      (call: unknown[]) => call[0] === "unhandledrejection",
    )![1] as (ev: PromiseRejectionEvent) => void;
    const err = new Error("promise rejected");
    rejectionHandler({ reason: err } as PromiseRejectionEvent);

    expect(client.captureError).toHaveBeenCalledWith(err, { type: "unhandledrejection" });
    cleanup();
  });

  it("unhandledrejection handler wraps non-Error reason in a new Error", () => {
    const client = makeMockClient();
    const cleanup = setupGlobalErrorHandlers(client);

    const rejectionHandler = mockAddEventListener.mock.calls.find(
      (call: unknown[]) => call[0] === "unhandledrejection",
    )![1] as (ev: PromiseRejectionEvent) => void;
    rejectionHandler({ reason: 42 } as unknown as PromiseRejectionEvent);

    const captured = (client.captureError as ReturnType<typeof vi.fn>).mock.calls[0][0] as Error;
    expect(captured).toBeInstanceOf(Error);
    expect(captured.message).toBe("42");
    cleanup();
  });

  it("cleanup removes both window event listeners", () => {
    const client = makeMockClient();
    const cleanup = setupGlobalErrorHandlers(client);
    cleanup();

    expect(mockRemoveEventListener).toHaveBeenCalledWith("error", expect.any(Function));
    expect(mockRemoveEventListener).toHaveBeenCalledWith("unhandledrejection", expect.any(Function));
  });
});
