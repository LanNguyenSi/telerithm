"use client";

import { useEffect, useState } from "react";
import { Select } from "@/components/ui/select";
import type { Team } from "@/types";

const TEAM_ROLES = ["OWNER", "ADMIN", "MEMBER", "VIEWER"] as const;
const ROLE_OPTIONS = TEAM_ROLES.map((teamRole) => ({ value: teamRole, label: teamRole }));

export function AddToTeamModal({
  open,
  teams,
  onClose,
  onSubmit,
}: {
  open: boolean;
  teams: Array<Team & { memberCount: number }>;
  onClose: () => void;
  onSubmit: (payload: { teamId: string; role: (typeof TEAM_ROLES)[number] }) => Promise<void>;
}) {
  const [teamId, setTeamId] = useState(teams[0]?.id ?? "");
  const [role, setRole] = useState<(typeof TEAM_ROLES)[number]>("MEMBER");
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (open) {
      setTeamId(teams[0]?.id ?? "");
      setRole("MEMBER");
      setPending(false);
    }
  }, [open, teams]);

  if (!open) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-[300] flex items-center justify-center bg-slate-950/40 px-4">
      <div className="w-full max-w-md rounded-[28px] border border-line bg-white p-6 shadow-panel dark:bg-slate-900">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-lg font-semibold text-ink">Add user to team</h3>
            <p className="mt-1 text-sm text-muted">Choose the target team and membership role.</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-line px-3 py-1.5 text-sm text-muted transition hover:text-ink"
          >
            Close
          </button>
        </div>

        <div className="mt-5 space-y-4">
          <div>
            <label htmlFor="teamId" className="block text-sm text-muted">
              Team
            </label>
            <Select
              id="teamId"
              value={teamId}
              onChange={setTeamId}
              className="mt-1"
              buttonClassName="rounded-xl px-4 py-2.5"
              options={teams.map((team) => ({
                value: team.id,
                label: `${team.name} (${team.memberCount})`,
              }))}
            />
          </div>

          <div>
            <label htmlFor="role" className="block text-sm text-muted">
              Role
            </label>
            <Select
              id="role"
              value={role}
              onChange={(value) => setRole(value as (typeof TEAM_ROLES)[number])}
              className="mt-1"
              buttonClassName="rounded-xl px-4 py-2.5"
              options={ROLE_OPTIONS}
            />
          </div>
        </div>

        <div className="mt-6 flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-line px-4 py-2 text-sm text-ink transition hover:border-slate-400"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={pending || !teamId}
            onClick={async () => {
              setPending(true);
              try {
                await onSubmit({ teamId, role });
                onClose();
              } finally {
                setPending(false);
              }
            }}
            className="rounded-xl bg-slate-950 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-800 disabled:opacity-50"
          >
            {pending ? "Saving..." : "Add to team"}
          </button>
        </div>
      </div>
    </div>
  );
}
