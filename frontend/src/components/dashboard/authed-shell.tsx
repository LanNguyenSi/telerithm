import type { PropsWithChildren } from "react";
import { AppShell } from "./app-shell";
import { getSession } from "@/lib/auth/session";
import { getVerifiedUser } from "@/lib/auth/guard";

export async function AuthedShell({ children }: PropsWithChildren) {
  const session = await getSession();
  // Name and email come from the readable cookie, but the role (it decides
  // whether the Admin link shows) from the backend. When the backend cannot
  // confirm the user, show the plain-user navigation.
  const verified = session ? await getVerifiedUser(session.token) : null;
  const user = session ? { ...session.user, role: verified?.role ?? ("USER" as const) } : null;
  return <AppShell user={user}>{children}</AppShell>;
}
