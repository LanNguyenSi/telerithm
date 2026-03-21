import Link from "next/link";
import type { PropsWithChildren } from "react";
import { LogoutButton } from "./logout-button";
import { MobileNav } from "./mobile-nav";

const navigation = [
  { href: "/", label: "Overview" },
  { href: "/logs", label: "Logs" },
  { href: "/issues", label: "Issues" },
  { href: "/alerts", label: "Alerts" },
  { href: "/dashboards", label: "Dashboards" },
  { href: "/settings", label: "Settings" },
] as const;

interface AppShellProps extends PropsWithChildren {
  user?: { name: string } | null;
}

export function AppShell({ children, user }: AppShellProps) {
  return (
    <div className="min-h-screen bg-paper text-ink">
      <div className="absolute inset-x-0 top-0 -z-10 h-[420px] bg-[radial-gradient(circle_at_top_left,_rgba(14,165,233,0.22),_transparent_45%),radial-gradient(circle_at_top_right,_rgba(249,115,22,0.18),_transparent_42%),linear-gradient(180deg,_#fffaf2_0%,_#f6f7fb_100%)] dark:bg-[radial-gradient(circle_at_top_left,_rgba(14,165,233,0.15),_transparent_45%),radial-gradient(circle_at_top_right,_rgba(249,115,22,0.10),_transparent_42%),linear-gradient(180deg,_#0d1117_0%,_#0d1117_100%)]" />
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-10 lg:py-8">
        <header className="relative rounded-[32px] border border-white/70 bg-white/65 px-5 py-4 shadow-panel backdrop-blur sm:px-6 sm:py-5">
          <div className="flex items-center justify-between gap-4 lg:hidden">
            <div>
              <p className="font-mono text-xs uppercase tracking-[0.4em] text-muted">Telerithm</p>
              <h1 className="mt-1 text-xl font-semibold tracking-tight">Log Analytics</h1>
            </div>
            <MobileNav />
          </div>

          <div className="hidden lg:flex lg:items-center lg:justify-between">
            <div>
              <p className="font-mono text-xs uppercase tracking-[0.4em] text-muted">Telerithm</p>
              <h1 className="mt-2 text-3xl font-semibold tracking-tight">
                Operational clarity for noisy systems
              </h1>
            </div>
            <div className="flex flex-col items-end gap-3">
              <nav className="flex flex-wrap gap-2">
                {navigation.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    className="rounded-full border border-line bg-white/80 px-4 py-2 text-sm text-ink transition hover:border-slate-400"
                  >
                    {item.label}
                  </Link>
                ))}
              </nav>
              {user && (
                <div className="flex items-center gap-3 text-sm text-muted">
                  <span>{user.name}</span>
                  <LogoutButton />
                </div>
              )}
            </div>
          </div>
        </header>
        <main className="mt-6 lg:mt-8">{children}</main>
      </div>
    </div>
  );
}
