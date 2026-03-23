import clsx from "clsx";
import type { PropsWithChildren } from "react";

export function Card({ children, className }: PropsWithChildren<{ className?: string }>) {
  return (
    <section
      className={clsx(
        "rounded-2xl border border-line bg-panel/85 p-5 shadow-panel backdrop-blur dark:shadow-panel-dark",
        className,
      )}
    >
      {children}
    </section>
  );
}
