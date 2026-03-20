import { AuthedShell } from "@/components/dashboard/authed-shell";
import { requireAuth } from "@/lib/auth/guard";
import { LogExplorer } from "./screen";

export const dynamic = "force-dynamic";

export default async function LogsPage() {
  const { team } = await requireAuth();

  return (
    <AuthedShell>
      <LogExplorer team={team} />
    </AuthedShell>
  );
}
