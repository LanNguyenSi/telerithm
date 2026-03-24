import { SkeletonCard } from "@/components/ui/skeleton";

export default function AlertsLoading() {
  return (
    <>
      <div className="mb-4 h-8 w-24 animate-pulse rounded-full bg-slate-900/[0.07] lg:mb-6" />
      <section className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr] lg:gap-6">
        <SkeletonCard className="min-h-80" />
        <SkeletonCard className="min-h-80" />
      </section>
    </>
  );
}
