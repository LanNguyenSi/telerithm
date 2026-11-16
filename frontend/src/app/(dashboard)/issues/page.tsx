import type { Metadata } from "next";
import { requireAuth } from "@/lib/auth/guard";
import { IssueExplorer } from "./screen";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Issues" };

export default async function IssuesPage() {
  const { team } = await requireAuth();

  return <IssueExplorer team={team} />;
}
