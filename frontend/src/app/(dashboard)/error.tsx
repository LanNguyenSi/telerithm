"use client";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-6 py-24 text-center">
      <div className="rounded-full bg-danger/10 p-4">
        <svg
          className="h-8 w-8 text-danger"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4.5c-.77-.833-2.694-.833-3.464 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z"
          />
        </svg>
      </div>
      <div>
        <h2 className="text-xl font-semibold text-ink">Something went wrong</h2>
        <p className="mt-2 max-w-md text-sm text-muted">
          {error.message || "An unexpected error occurred. Please try again."}
        </p>
      </div>
      <button
        onClick={reset}
        className="rounded-2xl bg-slate-950 px-6 py-2.5 text-sm font-medium text-white transition hover:bg-slate-800"
      >
        Try again
      </button>
    </div>
  );
}
