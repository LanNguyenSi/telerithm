import type { Metadata } from "next";
import { LogDetailScreen } from "./screen";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Log Detail" };

export default function LogDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  return <LogDetailScreen paramsPromise={params} />;
}
