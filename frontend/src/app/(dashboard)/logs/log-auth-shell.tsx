"use client";

import type { PropsWithChildren } from "react";
import { LogAuthProvider } from "@/components/logs/log-auth-context";
import { LogsTabNav } from "@/components/logs/logs-tab-nav";
import type { TeamWithRole } from "@/types";

export function LogAuthShell({
  team,
  children,
}: PropsWithChildren<{ team: TeamWithRole }>) {
  return (
    <LogAuthProvider value={{ team }}>
      <LogsTabNav />
      {children}
    </LogAuthProvider>
  );
}
