"use client";

import Link from "next/link";
import { useActionState } from "react";
import { loginAction } from "@/lib/auth/actions";

export function LoginForm({ registrationMode }: { registrationMode: "open" | "invite-only" | "approval" }) {
  const [state, action, pending] = useActionState(loginAction, null);

  return (
    <div className="flex min-h-screen items-center justify-center bg-paper">
      <div className="w-full max-w-sm space-y-6 px-6">
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.4em] text-muted">Telerithm</p>
          <h1 className="mt-2 text-2xl font-semibold text-ink">Sign in</h1>
        </div>

        <form action={action} className="space-y-4">
          {state?.error && (
            <p className="rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700">{state.error}</p>
          )}
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
              className="mt-1 w-full rounded-xl border border-line bg-white px-4 py-2.5 text-ink outline-none focus:border-slate-400"
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
              autoComplete="current-password"
              className="mt-1 w-full rounded-xl border border-line bg-white px-4 py-2.5 text-ink outline-none focus:border-slate-400"
            />
          </div>
          <button
            type="submit"
            disabled={pending}
            className="w-full rounded-xl bg-slate-950 py-2.5 text-sm font-medium text-white transition hover:bg-slate-800 disabled:opacity-50"
          >
            {pending ? "Signing in..." : "Sign in"}
          </button>
        </form>

        {registrationMode === "invite-only" ? (
          <p className="text-center text-sm text-muted">
            Registration is invite-only. Ask an admin to approve or invite you.
          </p>
        ) : (
          <p className="text-center text-sm text-muted">
            No account?{" "}
            <Link href="/register" className="font-medium text-ink underline underline-offset-4">
              Register
            </Link>
          </p>
        )}
      </div>
    </div>
  );
}
