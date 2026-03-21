import { AppShell } from "@/components/dashboard/app-shell";
import { SkeletonTable } from "@/components/ui/skeleton";

export default function IssuesLoading() {
  return (
    <AppShell>
      <SkeletonTable rows={8} />
    </AppShell>
  );
}
