import clsx from "clsx";
import type { PropsWithChildren } from "react";

export function Card({
  children,
  className,
}: PropsWithChildren<{ className?: string }>) {
  return (
    <section
      className={clsx(
        "rounded-[28px] border border-line bg-panel/85 p-6 shadow-panel backdrop-blur",
        className,
      )}
    >
      {children}
    </section>
  );
}

