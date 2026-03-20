import type { LogForgeClient } from "../client.js";

export function setupGlobalErrorHandlers(client: LogForgeClient): () => void {
  const isBrowser = typeof window !== "undefined";
  const isNode = typeof process !== "undefined" && typeof process.on === "function";
  const cleanups: Array<() => void> = [];

  if (isBrowser) {
    const onError = (event: ErrorEvent) => {
      client.captureError(event.error ?? new Error(event.message), {
        source: event.filename,
        lineno: event.lineno,
        colno: event.colno,
      });
    };

    const onUnhandledRejection = (event: PromiseRejectionEvent) => {
      const error =
        event.reason instanceof Error ? event.reason : new Error(String(event.reason));
      client.captureError(error, { type: "unhandledrejection" });
    };

    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onUnhandledRejection);

    cleanups.push(() => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onUnhandledRejection);
    });
  }

  if (isNode) {
    const onUncaught = (err: Error) => {
      client.captureError(err, { type: "uncaughtException" });
    };

    const onUnhandled = (reason: unknown) => {
      const error = reason instanceof Error ? reason : new Error(String(reason));
      client.captureError(error, { type: "unhandledRejection" });
    };

    process.on("uncaughtException", onUncaught);
    process.on("unhandledRejection", onUnhandled);

    cleanups.push(() => {
      process.removeListener("uncaughtException", onUncaught);
      process.removeListener("unhandledRejection", onUnhandled);
    });
  }

  return () => cleanups.forEach((fn) => fn());
}
