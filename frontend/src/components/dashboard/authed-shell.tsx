import type { PropsWithChildren } from "react";
import { AppShell } from "./app-shell";
import { getSession } from "@/lib/auth/session";

export async function AuthedShell({ children }: PropsWithChildren) {
  const session = await getSession();
  return <AppShell user={session?.user ?? null}>{children}</AppShell>;
}
