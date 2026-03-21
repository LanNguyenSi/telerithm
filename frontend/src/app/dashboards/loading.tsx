import { AppShell } from "@/components/dashboard/app-shell";
import { SkeletonCard } from "@/components/ui/skeleton";

export default function DashboardsLoading() {
  return (
    <AppShell>
      <div className="grid gap-4 lg:grid-cols-2 lg:gap-6">
        <SkeletonCard className="min-h-64" />
        <SkeletonCard className="min-h-64" />
      </div>
    </AppShell>
  );
}
