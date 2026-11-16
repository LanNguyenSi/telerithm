import type { Metadata } from "next";
import { requireSession } from "@/lib/auth/guard";
import { TodayScreen } from "./today-screen";

export const metadata: Metadata = { title: "Logs - Today" };

// The one page that still hands the session token to the browser: the live
// tail's EventSource authenticates with it in the stream URL.
export default async function LogsPage() {
  const { token } = await requireSession();
  return <TodayScreen liveTailToken={token} />;
}
