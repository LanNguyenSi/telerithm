import type { TeamRole } from "@/types";

/**
 * Mirrors the backend write gate (canWrite in the REST router): OWNER, ADMIN
 * and MEMBER may change team data, VIEWER is read-only. The UI uses it to hide
 * write controls; the API enforces the rule regardless.
 */
export function canWriteTeam(role: TeamRole): boolean {
  return role === "OWNER" || role === "ADMIN" || role === "MEMBER";
}
