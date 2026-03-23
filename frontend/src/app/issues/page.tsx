import type { Metadata } from "next";
import { AuthedShell } from "@/components/dashboard/authed-shell";
import { requireAuth } from "@/lib/auth/guard";
import { IssueExplorer } from "./screen";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Issues" };

export default async function IssuesPage() {
  const { team } = await requireAuth();

  return (
    <AuthedShell>
      <IssueExplorer team={team} />
    </AuthedShell>
  );
}
