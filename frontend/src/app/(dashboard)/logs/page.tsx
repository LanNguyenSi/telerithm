import type { Metadata } from "next";
import { TodayScreen } from "./today-screen";

export const metadata: Metadata = { title: "Logs - Today" };

// The logs layout has already required a session. The live tail asks for its
// own one-time stream ticket through the /bff proxy, so this page, like every
// other, carries no session token.
export default function LogsPage() {
  return <TodayScreen />;
}
