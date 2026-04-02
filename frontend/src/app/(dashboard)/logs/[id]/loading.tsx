import { SkeletonCard } from "@/components/ui/skeleton";

export default function LogDetailLoading() {
  return (
    <div className="space-y-4">
      <SkeletonCard className="min-h-40" />
      <SkeletonCard className="min-h-32" />
    </div>
  );
}
