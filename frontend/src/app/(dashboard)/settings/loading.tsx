import { SkeletonCard } from "@/components/ui/skeleton";

export default function SettingsLoading() {
  return (
    <div className="grid gap-4 lg:grid-cols-[0.9fr_1.1fr] lg:gap-6">
      <SkeletonCard className="min-h-40" />
      <SkeletonCard className="min-h-64" />
    </div>
  );
}
