import clsx from "clsx";
import type { PropsWithChildren } from "react";

export function Badge({
  children,
  tone = "neutral",
}: PropsWithChildren<{ tone?: "neutral" | "danger" | "signal" | "warning" }>) {
  return (
    <span
      className={clsx(
        "inline-flex items-center rounded-full px-3 py-1 text-xs font-medium uppercase tracking-[0.18em]",
        tone === "neutral" && "bg-slate-900/5 text-slate-700",
        tone === "danger" && "bg-rose-100 text-rose-700",
        tone === "signal" && "bg-cyan-100 text-cyan-700",
        tone === "warning" && "bg-amber-100 text-amber-700",
      )}
    >
      {children}
    </span>
  );
}

