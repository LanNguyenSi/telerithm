import { cache } from "react";
import { redirect } from "next/navigation";
import { getSession } from "./session";
import { getCurrentUser, getTeams } from "@/lib/api/client";
import type { SessionUser, TeamWithRole } from "@/types";

/**
 * A session cookie must exist; otherwise redirect to /login. The `user` it
 * returns comes from the readable `telerithm_user` cookie: use it for display
 * only, never to decide what the caller may do (see requireAdmin).
 */
export async function requireSession(): Promise<{ token: string; user: SessionUser }> {
  const session = await getSession();
  if (!session) redirect("/login");
  return session;
}

/**
 * The user as the backend has them for this token, or null when the backend
 * cannot confirm one (it answers 401, is unreachable or fails). The one source
 * of a role for an authorization decision: the `telerithm_user` cookie is
 * writable by the browser and only feeds the display of name and email.
 * Memoised per request, so a layout and a page asking for it share one call.
 */
export const getVerifiedUser = cache(async (token: string): Promise<SessionUser | null> => {
  try {
    return (await getCurrentUser(token)).user;
  } catch {
    return null;
  }
});

/**
 * Pages for administrators. The role is read from the backend, not from the
 * cookie: a forged `telerithm_user` with role ADMIN gets the same redirect as a
 * plain user (the API refuses it as well, this keeps the page from rendering).
 */
export async function requireAdmin(): Promise<{ token: string; user: SessionUser }> {
  const session = await requireSession();
  const user = await getVerifiedUser(session.token);
  if (!user || user.role !== "ADMIN") {
    redirect("/");
  }
  return { token: session.token, user };
}

/**
 * Get the current authenticated session and first team.
 * Redirects to /login if no session exists.
 */
export async function requireAuth(): Promise<{ token: string; user: SessionUser; team: TeamWithRole }> {
  const session = await requireSession();
  const { teams } = await getTeams(session.token);
  const team = teams[0];
  if (!team) {
    throw new Error("No team found. Please create or join a team first.");
  }

  return { token: session.token, user: session.user, team };
}
