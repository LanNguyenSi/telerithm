import clsx from "clsx";

export function Skeleton({ className }: { className?: string }) {
  return <div className={clsx("animate-pulse rounded-2xl bg-slate-900/[0.07]", className)} />;
}

export function SkeletonCard({ className }: { className?: string }) {
  return (
    <section
      className={clsx(
        "rounded-[28px] border border-line bg-panel/85 p-6 shadow-panel backdrop-blur",
        className,
      )}
    >
      <Skeleton className="h-4 w-32" />
      <Skeleton className="mt-4 h-10 w-48" />
      <Skeleton className="mt-3 h-4 w-64" />
    </section>
  );
}

export function SkeletonRow() {
  return (
    <div className="flex gap-4 border-b border-line/50 px-4 py-4">
      <Skeleton className="h-4 w-28 shrink-0" />
      <Skeleton className="h-4 w-16 shrink-0" />
      <Skeleton className="h-4 w-24 shrink-0" />
      <Skeleton className="h-4 w-20 shrink-0" />
      <Skeleton className="h-4 flex-1" />
    </div>
  );
}

export function SkeletonTable({ rows = 8 }: { rows?: number }) {
  return (
    <section className="rounded-[28px] border border-line bg-panel/85 shadow-panel backdrop-blur overflow-hidden p-0">
      <div className="border-b border-line bg-slate-950 px-4 py-4">
        <div className="flex gap-4">
          {["w-28", "w-16", "w-24", "w-20", "flex-1"].map((w, i) => (
            <div key={i} className={clsx("h-3 rounded bg-white/10", w)} />
          ))}
        </div>
      </div>
      {Array.from({ length: rows }).map((_, i) => (
        <SkeletonRow key={i} />
      ))}
    </section>
  );
}
