import { redirect } from "next/navigation";
import { getSession } from "./session";
import { getTeams } from "@/lib/api/client";
import type { SessionUser, Team } from "@/types";

export async function requireSession(): Promise<{ token: string; user: SessionUser }> {
  const session = await getSession();
  if (!session) redirect("/login");
  return session;
}

export async function requireAdmin(): Promise<{ token: string; user: SessionUser }> {
  const session = await requireSession();
  if (session.user.role !== "ADMIN") {
    redirect("/");
  }
  return session;
}

/**
 * Get the current authenticated session and first team.
 * Redirects to /login if no session exists.
 */
export async function requireAuth(): Promise<{ token: string; user: SessionUser; team: Team }> {
  const session = await requireSession();
  const { teams } = await getTeams(session.token);
  const team = teams[0];
  if (!team) {
    throw new Error("No team found. Please create or join a team first.");
  }

  return { token: session.token, user: session.user, team };
}
