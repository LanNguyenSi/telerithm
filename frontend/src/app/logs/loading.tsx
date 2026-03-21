import { AppShell } from "@/components/dashboard/app-shell";
import { SkeletonCard, SkeletonTable } from "@/components/ui/skeleton";

export default function LogsLoading() {
  return (
    <AppShell>
      <div className="space-y-4 lg:space-y-6">
        <SkeletonCard className="min-h-40" />
        <SkeletonCard className="h-16" />
        <SkeletonTable rows={10} />
      </div>
    </AppShell>
  );
}
