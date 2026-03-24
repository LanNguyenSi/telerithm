import type { PropsWithChildren } from "react";
import { AuthedShell } from "@/components/dashboard/authed-shell";

export default function DashboardLayout({ children }: PropsWithChildren) {
  return <AuthedShell>{children}</AuthedShell>;
}
