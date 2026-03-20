"use client";

import { logoutAction } from "@/lib/auth/actions";

export function LogoutButton() {
  return (
    <form action={logoutAction}>
      <button
        type="submit"
        className="rounded-full border border-line bg-white/80 px-3 py-1 text-xs text-muted transition hover:border-slate-400 hover:text-ink"
      >
        Sign out
      </button>
    </form>
  );
}
