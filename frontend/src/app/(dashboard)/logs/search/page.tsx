import type { Metadata } from "next";
import { SearchScreen } from "./screen";

export const metadata: Metadata = { title: "Log Search" };

export default function LogSearchPage() {
  return <SearchScreen />;
}
