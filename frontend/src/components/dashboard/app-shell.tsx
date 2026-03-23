import Link from "next/link";
import type { PropsWithChildren } from "react";
import { LogoutButton } from "./logout-button";
import { MobileNav } from "./mobile-nav";
import { ThemeToggle } from "./theme-toggle";
import type { SessionUser } from "@/types";

const baseNavigation = [
  { href: "/", label: "Overview" },
  { href: "/logs", label: "Logs" },
  { href: "/issues", label: "Issues" },
  { href: "/alerts", label: "Alerts" },
  { href: "/dashboards", label: "Dashboards" },
  { href: "/settings", label: "Settings" },
] as const;

interface AppShellProps extends PropsWithChildren {
  user?: SessionUser | null;
}

export function AppShell({ children, user }: AppShellProps) {
  const navigation =
    user?.role === "ADMIN" ? [...baseNavigation, { href: "/admin", label: "Admin" }] : baseNavigation;

  return (
    <div className="min-h-screen bg-paper text-ink">
      <div className="absolute inset-x-0 top-0 -z-10 h-[320px] bg-[radial-gradient(circle_at_top_left,_rgba(14,165,233,0.12),_transparent_45%),radial-gradient(circle_at_top_right,_rgba(249,115,22,0.10),_transparent_42%),linear-gradient(180deg,_#fffaf2_0%,_#f6f7fb_100%)] dark:bg-[radial-gradient(circle_at_top_left,_rgba(14,165,233,0.08),_transparent_45%),radial-gradient(circle_at_top_right,_rgba(249,115,22,0.06),_transparent_42%),linear-gradient(180deg,_#0d1117_0%,_#0d1117_100%)]" />
      <div className="mx-auto max-w-7xl px-4 py-4 sm:px-6 lg:px-10 lg:py-6">
        <header className="relative z-[100] rounded-2xl border border-white/70 bg-white/65 px-4 py-3 shadow-panel backdrop-blur dark:border-white/10 dark:bg-white/5 dark:shadow-panel-dark sm:px-5 sm:py-4">
          <div className="flex items-center justify-between gap-4 lg:hidden">
            <div>
              <p className="font-mono text-[10px] uppercase tracking-[0.4em] text-muted">Telerithm</p>
              <h1 className="mt-0.5 text-lg font-semibold tracking-tight">Log Analytics</h1>
            </div>
            <div className="flex items-center gap-2">
              <ThemeToggle />
              <MobileNav isAdmin={user?.role === "ADMIN"} />
            </div>
          </div>

          <div className="hidden lg:flex lg:items-center lg:justify-between">
            <div>
              <p className="font-mono text-[10px] uppercase tracking-[0.4em] text-muted">Telerithm</p>
              <h1 className="mt-1 text-xl font-semibold tracking-tight">
                Operational clarity for noisy systems
              </h1>
            </div>
            <div className="flex flex-col items-end gap-2">
              <nav className="flex flex-wrap items-center gap-1.5">
                {navigation.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    className="rounded-lg border border-line bg-white/80 px-3 py-1.5 text-sm text-ink transition hover:border-slate-400 dark:bg-white/5"
                  >
                    {item.label}
                  </Link>
                ))}
                <ThemeToggle />
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
        <main className="mt-4 lg:mt-6">{children}</main>
      </div>
    </div>
  );
}
