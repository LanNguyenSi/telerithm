"use client";

import { AppShell } from "@/components/dashboard/app-shell";
import { Card } from "@/components/ui/card";

export default function AlertsError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <AppShell>
      <Card>
        <div className="flex flex-col items-center gap-4 py-12 text-center">
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
          <h2 className="text-lg font-semibold text-ink">Failed to load alerts</h2>
          <p className="max-w-md text-sm text-muted">
            {error.message || "Could not fetch alert data. Please try again."}
          </p>
          <button
            onClick={reset}
            className="mt-2 rounded-2xl bg-slate-950 px-5 py-2 text-sm font-medium text-white transition hover:bg-slate-800"
          >
            Retry
          </button>
        </div>
      </Card>
    </AppShell>
  );
}
