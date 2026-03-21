import { AppShell } from "@/components/dashboard/app-shell";
import { SkeletonCard } from "@/components/ui/skeleton";

export default function HomeLoading() {
  return (
    <AppShell>
      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 lg:gap-6">
        <SkeletonCard />
        <SkeletonCard />
        <SkeletonCard />
      </section>
      <section className="mt-4 grid gap-4 lg:mt-6 lg:grid-cols-[1.2fr_0.8fr] lg:gap-6">
        <SkeletonCard className="min-h-64" />
        <SkeletonCard className="min-h-64" />
      </section>
    </AppShell>
  );
}
