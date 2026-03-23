"use client";

import Link from "next/link";
import { useActionState } from "react";
import { registerAction } from "@/lib/auth/actions";

export function RegisterForm({
  registrationMode,
}: {
  registrationMode: "open" | "invite-only" | "approval";
}) {
  const [state, action, pending] = useActionState(registerAction, null);

  return (
    <div className="flex min-h-screen items-center justify-center bg-paper">
      <div className="w-full max-w-sm space-y-6 px-6">
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.4em] text-muted">Telerithm</p>
          <h1 className="mt-2 text-2xl font-semibold text-ink">Create account</h1>
          {registrationMode === "approval" && (
            <p className="mt-2 text-sm text-muted">
              New accounts require admin approval before they can access logs.
            </p>
          )}
        </div>

        {state?.pendingApproval ? (
          <div className="rounded-[28px] border border-line bg-white/80 p-6 shadow-panel dark:bg-white/5">
            <h2 className="text-lg font-semibold text-ink">Request submitted</h2>
            <p className="mt-2 text-sm text-muted">
              {state.success ?? "Your account is waiting for admin approval."}
            </p>
            <p className="mt-4 text-sm text-muted">
              You can return to{" "}
              <Link href="/login" className="font-medium text-ink underline underline-offset-4">
                sign in
              </Link>{" "}
              after you have been approved.
            </p>
          </div>
        ) : (
          <form action={action} className="space-y-4">
            {state?.error && (
              <p className="rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:bg-rose-900/20 dark:text-rose-300">
                {state.error}
              </p>
            )}
            <div>
              <label htmlFor="name" className="block text-sm text-muted">
                Name
              </label>
              <input
                id="name"
                name="name"
                type="text"
                required
                autoComplete="name"
                className="mt-1 w-full rounded-xl border border-line bg-white px-4 py-2.5 text-ink outline-none focus:border-slate-400 dark:bg-white/10"
              />
            </div>
            <div>
              <label htmlFor="email" className="block text-sm text-muted">
                Email
              </label>
              <input
                id="email"
                name="email"
                type="email"
                required
                autoComplete="email"
                className="mt-1 w-full rounded-xl border border-line bg-white px-4 py-2.5 text-ink outline-none focus:border-slate-400 dark:bg-white/10"
              />
            </div>
            <div>
              <label htmlFor="password" className="block text-sm text-muted">
                Password
              </label>
              <input
                id="password"
                name="password"
                type="password"
                required
                minLength={6}
                autoComplete="new-password"
                className="mt-1 w-full rounded-xl border border-line bg-white px-4 py-2.5 text-ink outline-none focus:border-slate-400 dark:bg-white/10"
              />
            </div>
            <button
              type="submit"
              disabled={pending}
              className="w-full rounded-xl bg-slate-950 py-2.5 text-sm font-medium text-white transition hover:bg-slate-800 disabled:opacity-50"
            >
              {pending ? "Creating account..." : "Create account"}
            </button>
          </form>
        )}

        <p className="text-center text-sm text-muted">
          Already have an account?{" "}
          <Link href="/login" className="font-medium text-ink underline underline-offset-4">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
