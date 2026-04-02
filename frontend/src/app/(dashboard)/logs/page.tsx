import type { Metadata } from "next";
import { TodayScreen } from "./today-screen";

export const metadata: Metadata = { title: "Logs - Today" };

export default function LogsPage() {
  return <TodayScreen />;
}
