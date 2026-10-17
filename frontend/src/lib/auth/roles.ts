import type { TeamRole } from "@/types";

/**
 * Mirrors the backend write gate (canWrite in the REST router): OWNER, ADMIN
 * and MEMBER may change team data, VIEWER is read-only. The UI uses it to hide
 * write controls; the API enforces the rule regardless.
 */
export function canWriteTeam(role: TeamRole): boolean {
  return role === "OWNER" || role === "ADMIN" || role === "MEMBER";
}

/**
 * Mirrors the backend rule for deleting a log source and rotating its ingest
 * key (canManageSources in the REST router): OWNER and ADMIN only. The UI uses
 * it to hide rename, delete and rotate; the API enforces the rule regardless.
 */
export function canManageSources(role: TeamRole): boolean {
  return role === "OWNER" || role === "ADMIN";
}
