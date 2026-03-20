import { redirect } from "next/navigation";
import { getSession } from "./session";
import { getTeams } from "@/lib/api/client";
import type { Team } from "@/types";

/**
 * Get the current authenticated session and first team.
 * Redirects to /login if no session exists.
 */
export async function requireAuth(): Promise<{ token: string; user: { id: string; email: string; name: string }; team: Team }> {
  const session = await getSession();
  if (!session) redirect("/login");

  const { teams } = await getTeams(session.token);
  const team = teams[0];
  if (!team) {
    throw new Error("No team found. Please create or join a team first.");
  }

  return { token: session.token, user: session.user, team };
}
