import type { PropsWithChildren } from "react";
import { Sidebar } from "./sidebar";
import type { SessionUser } from "@/types";

interface AppShellProps extends PropsWithChildren {
  user?: SessionUser | null;
}

export function AppShell({ children, user }: AppShellProps) {
  return (
    <div className="min-h-screen bg-paper text-ink">
      <Sidebar user={user} />

      {/* Main content area — offset by sidebar on desktop, by top bar on mobile */}
      <div className="lg:pl-52">
        <main className="mx-auto max-w-6xl px-4 py-6 pt-20 sm:px-6 lg:px-8 lg:py-8 lg:pt-8">
          {children}
        </main>
      </div>
    </div>
  );
}
