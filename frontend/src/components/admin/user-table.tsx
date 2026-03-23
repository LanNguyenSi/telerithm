"use client";

import { useState } from "react";
import { addAdminUserToTeam, approveAdminUser, removeAdminUserFromTeam } from "@/lib/api/client";
import { formatDate } from "@/lib/utils/format";
import type { AdminUser, Team } from "@/types";
import { AddToTeamModal } from "./add-to-team-modal";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";

function statusTone(status: AdminUser["status"]) {
  if (status === "ACTIVE") return "signal";
  if (status === "PENDING") return "warning";
  return "danger";
}

export function UserTable({
  initialUsers,
  teams,
  token,
}: {
  initialUsers: AdminUser[];
  teams: Array<Team & { memberCount: number }>;
  token: string;
}) {
  const [users, setUsers] = useState(initialUsers);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [modalUser, setModalUser] = useState<AdminUser | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function approve(userId: string) {
    setPendingId(userId);
    setError(null);
    try {
      const { user } = await approveAdminUser(userId, token);
      setUsers((current) =>
        current.map((entry) => (entry.id === userId ? { ...entry, status: user.status } : entry)),
      );
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Could not approve user");
    } finally {
      setPendingId(null);
    }
  }

  async function addToTeam(payload: { teamId: string; role: "OWNER" | "ADMIN" | "MEMBER" | "VIEWER" }) {
    if (!modalUser) return;

    setPendingId(modalUser.id);
    setError(null);
    try {
      await addAdminUserToTeam(modalUser.id, token, payload);
      const selectedTeam = teams.find((team) => team.id === payload.teamId);
      if (!selectedTeam) return;

      setUsers((current) =>
        current.map((entry) => {
          if (entry.id !== modalUser.id) return entry;

          const nextTeams = entry.teams.filter((team) => team.id !== payload.teamId);
          nextTeams.push({
            id: selectedTeam.id,
            name: selectedTeam.name,
            slug: selectedTeam.slug,
            role: payload.role,
            joinedAt: new Date().toISOString(),
          });

          return { ...entry, teams: nextTeams };
        }),
      );
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Could not add user to team");
    } finally {
      setPendingId(null);
    }
  }

  async function removeFromTeam(userId: string, teamId: string) {
    setPendingId(userId);
    setError(null);
    try {
      await removeAdminUserFromTeam(userId, teamId, token);
      setUsers((current) =>
        current.map((entry) =>
          entry.id === userId ? { ...entry, teams: entry.teams.filter((team) => team.id !== teamId) } : entry,
        ),
      );
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Could not remove team access");
    } finally {
      setPendingId(null);
    }
  }

  return (
    <>
      <Card>
        {error && <p className="mb-4 rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</p>}

        {users.length === 0 ? (
          <div className="py-10 text-center">
            <p className="text-base font-medium text-ink">No users yet</p>
            <p className="mt-2 text-sm text-muted">
              Registrations will appear here for approval and team assignment.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {users.map((user) => (
              <article key={user.id} className="rounded-[24px] border border-line bg-white/75 p-4">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-base font-semibold text-ink">{user.name}</p>
                      <Badge tone={statusTone(user.status)}>{user.status}</Badge>
                      <Badge>{user.role}</Badge>
                    </div>
                    <p className="font-mono text-sm text-muted">{user.email}</p>
                    <p className="text-sm text-muted">Joined {formatDate(user.createdAt)}</p>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {user.status === "PENDING" && (
                      <button
                        type="button"
                        disabled={pendingId === user.id}
                        onClick={() => void approve(user.id)}
                        className="rounded-xl bg-cyan-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-cyan-500 disabled:opacity-50"
                      >
                        {pendingId === user.id ? "Approving..." : "Approve"}
                      </button>
                    )}
                    <button
                      type="button"
                      disabled={pendingId === user.id || teams.length === 0}
                      onClick={() => setModalUser(user)}
                      className="rounded-xl border border-line px-4 py-2 text-sm text-ink transition hover:border-slate-400 disabled:opacity-50"
                    >
                      Add to team
                    </button>
                  </div>
                </div>

                <div className="mt-4">
                  <p className="text-xs uppercase tracking-[0.18em] text-muted">Teams</p>
                  {user.teams.length === 0 ? (
                    <p className="mt-2 text-sm text-muted">No team memberships yet.</p>
                  ) : (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {user.teams.map((team) => (
                        <div
                          key={`${user.id}:${team.id}`}
                          className="flex items-center gap-2 rounded-full border border-line bg-white px-3 py-1.5 text-sm text-ink"
                        >
                          <span>{team.name}</span>
                          <span className="text-xs text-muted">{team.role}</span>
                          <button
                            type="button"
                            disabled={pendingId === user.id}
                            onClick={() => void removeFromTeam(user.id, team.id)}
                            className="text-xs text-muted transition hover:text-rose-600 disabled:opacity-50"
                          >
                            Remove
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </article>
            ))}
          </div>
        )}
      </Card>

      <AddToTeamModal
        open={modalUser !== null}
        teams={teams}
        onClose={() => setModalUser(null)}
        onSubmit={addToTeam}
      />
    </>
  );
}
