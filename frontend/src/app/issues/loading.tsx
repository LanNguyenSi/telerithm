import { AppShell } from "@/components/dashboard/app-shell";
import { SkeletonCard, SkeletonTable } from "@/components/ui/skeleton";

export default function IssuesLoading() {
  return (
    <AppShell>
      <div className="space-y-4 lg:space-y-6">
        <SkeletonCard className="min-h-40" />
        <SkeletonTable rows={8} />
      </div>
    </AppShell>
  );
}
