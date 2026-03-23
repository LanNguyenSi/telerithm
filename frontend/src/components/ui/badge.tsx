import clsx from "clsx";
import type { PropsWithChildren } from "react";

export function Badge({
  children,
  tone = "neutral",
}: PropsWithChildren<{ tone?: "neutral" | "danger" | "signal" | "warning" }>) {
  return (
    <span
      className={clsx(
        "inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-medium uppercase tracking-[0.12em]",
        tone === "neutral" && "bg-slate-900/5 text-slate-700 dark:bg-white/5 dark:text-slate-300",
        tone === "danger" && "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300",
        tone === "signal" && "bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-300",
        tone === "warning" && "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300",
      )}
    >
      {children}
    </span>
  );
}
