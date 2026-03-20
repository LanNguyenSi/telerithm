import Link from "next/link";
import type { PropsWithChildren } from "react";

const navigation = [
  { href: "/", label: "Overview" },
  { href: "/logs", label: "Logs" },
  { href: "/issues", label: "Issues" },
  { href: "/alerts", label: "Alerts" },
  { href: "/dashboards", label: "Dashboards" },
  { href: "/settings", label: "Settings" },
] as const;

export function AppShell({ children }: PropsWithChildren) {
  return (
    <div className="min-h-screen bg-paper text-ink">
      <div className="absolute inset-x-0 top-0 -z-10 h-[420px] bg-[radial-gradient(circle_at_top_left,_rgba(14,165,233,0.22),_transparent_45%),radial-gradient(circle_at_top_right,_rgba(249,115,22,0.18),_transparent_42%),linear-gradient(180deg,_#fffaf2_0%,_#f6f7fb_100%)]" />
      <div className="mx-auto max-w-7xl px-6 py-8 lg:px-10">
        <header className="rounded-[32px] border border-white/70 bg-white/65 px-6 py-5 shadow-panel backdrop-blur">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="font-mono text-xs uppercase tracking-[0.4em] text-muted">LogForge</p>
              <h1 className="mt-2 text-3xl font-semibold tracking-tight">Operational clarity for noisy systems</h1>
            </div>
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
          </div>
        </header>
        <main className="mt-8">{children}</main>
      </div>
    </div>
  );
}
