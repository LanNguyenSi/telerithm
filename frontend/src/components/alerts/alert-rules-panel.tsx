"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertRuleForm } from "@/components/alerts/alert-rule-form";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { createAlertRule, deleteAlertRule, updateAlertRule } from "@/lib/api/client";
import { canWriteTeam } from "@/lib/auth/roles";
import type { AlertRule, TeamRole } from "@/types";

const buttonClass =
  "rounded-lg border border-line px-2.5 py-1 text-xs text-ink transition hover:border-slate-400 disabled:opacity-50";

/**
 * Alert rule list with create, edit, enable/disable and delete. The write
 * controls are rendered only for roles that may write; VIEWER gets the
 * read-only list (the API refuses VIEWER writes with 403 either way).
 */
export function AlertRulesPanel({
  rules,
  teamId,
  token,
  role,
}: {
  rules: AlertRule[];
  teamId: string;
  token: string;
  role: TeamRole;
}) {
  const router = useRouter();
  const writable = canWriteTeam(role);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<AlertRule | null>(null);
  const [deleting, setDeleting] = useState<AlertRule | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const openCreate = () => {
    setEditing(null);
    setFormOpen(true);
  };

  const openEdit = (rule: AlertRule) => {
    setEditing(rule);
    setFormOpen(true);
  };

  const toggleEnabled = async (rule: AlertRule) => {
    setBusyId(rule.id);
    setError(null);
    try {
      await updateAlertRule(rule.id, token, { enabled: !rule.enabled });
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Updating the rule failed.");
    } finally {
      setBusyId(null);
    }
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    const target = deleting;
    setDeleting(null);
    setBusyId(target.id);
    setError(null);
    try {
      await deleteAlertRule(target.id, token);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Deleting the rule failed.");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <Card>
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-ink">Alert Rules</h2>
        {writable ? (
          <button
            type="button"
            onClick={openCreate}
            className="rounded-lg bg-slate-950 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-slate-800 dark:bg-white dark:text-slate-950 dark:hover:bg-slate-200"
          >
            New rule
          </button>
        ) : null}
      </div>

      {error ? (
        <p role="alert" className="mt-3 text-sm text-rose-600 dark:text-rose-400">
          {error}
        </p>
      ) : null}

      {rules.length === 0 ? (
        <div className="mt-6 flex flex-col items-center gap-3 rounded-2xl border border-dashed border-line bg-white/50 p-8 text-center dark:bg-white/5">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="36"
            height="36"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="text-muted"
          >
            <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
            <path d="M13.73 21a2 2 0 0 1-3.46 0" />
          </svg>
          <p className="text-sm font-medium text-ink">No alert rules configured</p>
          <p className="max-w-xs text-sm text-muted">
            {writable
              ? "Create a rule with New rule. It counts log messages that contain your query text and opens an incident when the threshold is crossed."
              : "No rules exist for this team yet. Team members with write access can create them."}
          </p>
        </div>
      ) : (
        <div className="mt-4 space-y-3">
          {rules.map((rule) => (
            <article key={rule.id} className="rounded-xl border border-line bg-white/70 p-3 dark:bg-white/5">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm font-medium text-ink">{rule.name}</p>
                {!rule.enabled ? <Badge tone="neutral">Disabled</Badge> : null}
              </div>
              <p className="mt-1 text-xs text-muted">{rule.description ?? "No description"}</p>
              <p className="mt-1.5 font-mono text-xs text-muted">
                {rule.condition} {rule.threshold} in {rule.windowMinutes} min
              </p>
              {writable ? (
                <div className="mt-2 flex flex-wrap gap-2">
                  <label className="flex items-center gap-1.5 text-xs text-ink">
                    <input
                      type="checkbox"
                      checked={rule.enabled}
                      disabled={busyId === rule.id}
                      onChange={() => void toggleEnabled(rule)}
                      aria-label={`Enabled: ${rule.name}`}
                    />
                    Enabled
                  </label>
                  <button type="button" disabled={busyId === rule.id} onClick={() => openEdit(rule)} className={buttonClass}>
                    Edit
                  </button>
                  <button
                    type="button"
                    disabled={busyId === rule.id}
                    onClick={() => setDeleting(rule)}
                    className={buttonClass}
                  >
                    Delete
                  </button>
                </div>
              ) : null}
            </article>
          ))}
        </div>
      )}

      {writable ? (
        <>
          <AlertRuleForm
            open={formOpen}
            rule={editing}
            onClose={() => setFormOpen(false)}
            onSubmit={async (input) => {
              if (editing) {
                // description null clears an existing description.
                await updateAlertRule(editing.id, token, { ...input, description: input.description ?? null });
              } else {
                await createAlertRule(token, { teamId, ...input });
              }
              router.refresh();
            }}
          />
          <Dialog
            open={deleting !== null}
            variant="confirm"
            title={`Delete rule "${deleting?.name ?? ""}"?`}
            description="The rule, its incidents and its subscriptions are deleted permanently."
            onClose={() => setDeleting(null)}
            onConfirm={() => void confirmDelete()}
          />
        </>
      ) : null}
    </Card>
  );
}
