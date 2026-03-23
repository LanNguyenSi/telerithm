"use client";

import { AppShell } from "@/components/dashboard/app-shell";
import { Card } from "@/components/ui/card";

export default function IssuesError({
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
          <h2 className="text-lg font-semibold text-ink">Failed to load issues</h2>
          <p className="max-w-md text-sm text-muted">
            {error.message || "Could not fetch grouped issues right now. Please try again."}
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
