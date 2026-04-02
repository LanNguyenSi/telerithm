"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

const tabs = [
  { href: "/logs", label: "Today" },
  { href: "/logs/search", label: "Search" },
] as const;

export function LogsTabNav() {
  const pathname = usePathname();
  const router = useRouter();

  // On detail pages (/logs/<id>) show back button instead of tabs
  const isDetail = pathname.startsWith("/logs/") && pathname !== "/logs/search";
  if (isDetail) {
    return (
      <nav className="mb-4">
        <button
          type="button"
          onClick={() => router.back()}
          className="inline-flex items-center gap-1.5 text-sm text-muted transition hover:text-ink"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
          Back
        </button>
      </nav>
    );
  }

  return (
    <nav className="mb-4 flex gap-1 border-b border-line">
      {tabs.map((tab) => {
        const active = tab.href === "/logs" ? pathname === "/logs" : pathname.startsWith(tab.href);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={`px-3 py-2 text-sm font-medium transition ${
              active
                ? "border-b-2 border-ink text-ink"
                : "text-muted hover:text-ink"
            }`}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
