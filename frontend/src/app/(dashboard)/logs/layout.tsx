import type { PropsWithChildren } from "react";
import { requireAuth } from "@/lib/auth/guard";
import { LogAuthShell } from "./log-auth-shell";

export const dynamic = "force-dynamic";

export default async function LogsLayout({ children }: PropsWithChildren) {
  const { team, token } = await requireAuth();

  return <LogAuthShell team={team} token={token}>{children}</LogAuthShell>;
}
