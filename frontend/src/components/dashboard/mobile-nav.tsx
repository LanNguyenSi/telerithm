"use client";

import Link from "next/link";
import { useState } from "react";

const baseNavigation = [
  { href: "/", label: "Overview" },
  { href: "/logs", label: "Logs" },
  { href: "/issues", label: "Issues" },
  { href: "/alerts", label: "Alerts" },
  { href: "/dashboards", label: "Dashboards" },
  { href: "/settings", label: "Settings" },
] as const;

export function MobileNav({ isAdmin = false }: { isAdmin?: boolean }) {
  const [open, setOpen] = useState(false);
  const navigation = isAdmin ? [...baseNavigation, { href: "/admin", label: "Admin" }] : baseNavigation;

  return (
    <div className="lg:hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Toggle navigation"
        className="flex h-10 w-10 items-center justify-center rounded-full border border-line bg-white/80 transition hover:border-slate-400 dark:bg-white/5"
      >
        {open ? (
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        ) : (
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <line x1="4" y1="6" x2="20" y2="6" />
            <line x1="4" y1="12" x2="20" y2="12" />
            <line x1="4" y1="18" x2="20" y2="18" />
          </svg>
        )}
      </button>

      {open && (
        <div className="absolute inset-x-4 top-[88px] z-[200] rounded-[24px] border border-line bg-white/95 p-4 shadow-panel backdrop-blur dark:bg-slate-900/95">
          <nav className="grid grid-cols-2 gap-2">
            {navigation.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setOpen(false)}
                className="rounded-full border border-line bg-white/80 px-4 py-2.5 text-center text-sm text-ink transition hover:border-slate-400 dark:bg-white/5"
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </div>
      )}
    </div>
  );
}
