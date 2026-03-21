import type { Metadata } from "next";
import { AuthedShell } from "@/components/dashboard/authed-shell";
import { requireAuth } from "@/lib/auth/guard";
import { LogExplorer } from "./screen";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Logs" };

export default async function LogsPage() {
  const { team } = await requireAuth();

  return (
    <AuthedShell>
      <LogExplorer team={team} />
    </AuthedShell>
  );
}
