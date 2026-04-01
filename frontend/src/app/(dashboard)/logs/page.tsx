import type { Metadata } from "next";
import { requireAuth } from "@/lib/auth/guard";
import { LogExplorer } from "./screen";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Logs" };

export default async function LogsPage() {
  const { team, token } = await requireAuth();

  return <LogExplorer team={team} token={token} />;
}
