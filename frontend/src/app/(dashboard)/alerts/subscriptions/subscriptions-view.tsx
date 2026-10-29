"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Dialog, useDialog } from "@/components/ui/dialog";
import { createSubscription, deleteSubscription, testSubscription, updateSubscription } from "@/lib/api/client";
import { formatDate } from "@/lib/utils/format";
import { subscriptionRuleLabel } from "@/lib/utils/subscription-rule-label";
import type { AlertRule, AlertSubscription } from "@/types";
import { SubscriptionForm } from "./subscription-form";
import type { SubscriptionPayload } from "./subscription-input";

const buttonClass =
  "rounded-lg border border-line px-2.5 py-1 text-xs text-ink transition hover:border-slate-400 disabled:opacity-50";

function channelTone(channel: string) {
  if (channel === "SLACK") return "signal";
  if (channel === "EMAIL") return "neutral";
  if (channel === "WEBHOOK") return "warning";
  return "neutral";
}

function targetDescription(sub: AlertSubscription): string {
  if (sub.rule) return `rule "${sub.rule.name}"`;
  if (sub.ruleId !== null) return "a rule that is no longer available";
  return "all rules in the team";
}

type RowNotice = { kind: "ok" | "error"; text: string };

/**
 * Subscriptions page body: the user's own subscriptions with create, enable /
 * disable, send-test and delete, next to the team's rules (each with a Subscribe
 * shortcut). The API lets every team member manage their own subscriptions, so
 * no control is hidden by role; a refusal (403, 404, 429) is shown as the API
 * words it.
 */
export function SubscriptionsView({
  subscriptions,
  rules,
  teamId,
  token,
}: {
  subscriptions: AlertSubscription[];
  rules: AlertRule[];
  teamId: string;
  token: string;
}) {
  const router = useRouter();
  const dialog = useDialog();
  const [items, setItems] = useState(subscriptions);
  const [formOpen, setFormOpen] = useState(false);
  const [formRuleId, setFormRuleId] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notices, setNotices] = useState<Record<string, RowNotice>>({});

  useEffect(() => {
    setItems(subscriptions);
  }, [subscriptions]);

  const closeForm = useCallback(() => setFormOpen(false), []);

  const openForm = (ruleId: string) => {
    setFormRuleId(ruleId);
    setFormOpen(true);
  };

  const create = async (payload: SubscriptionPayload) => {
    const { subscription } = await createSubscription(token, payload);
    const rule = rules.find((r) => r.id === subscription.ruleId);
    setItems((current) => [
      { ...subscription, rule: rule ? { id: rule.id, name: rule.name } : null },
      ...current.filter((s) => s.id !== subscription.id),
    ]);
    setError(null);
    router.refresh();
  };

  const toggleEnabled = async (sub: AlertSubscription) => {
    setBusyId(sub.id);
    setError(null);
    try {
      const { subscription } = await updateSubscription(sub.id, token, { enabled: !sub.enabled });
      setItems((current) => current.map((s) => (s.id === sub.id ? { ...s, enabled: subscription.enabled } : s)));
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Updating the subscription failed.");
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (sub: AlertSubscription) => {
    const confirmed = await dialog.confirm(
      `Delete the ${sub.channel} subscription for ${targetDescription(sub)}?`,
      "You stop receiving these notifications. This cannot be undone.",
    );
    if (!confirmed) return;
    setBusyId(sub.id);
    setError(null);
    try {
      await deleteSubscription(sub.id, token);
      setItems((current) => current.filter((s) => s.id !== sub.id));
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Deleting the subscription failed.");
    } finally {
      setBusyId(null);
    }
  };

  const sendTest = async (sub: AlertSubscription) => {
    setBusyId(sub.id);
    setNotices((current) => Object.fromEntries(Object.entries(current).filter(([id]) => id !== sub.id)));
    try {
      const result = await testSubscription(sub.id, token);
      setNotices((current) => ({ ...current, [sub.id]: { kind: "ok", text: result.message || "Test notification sent" } }));
    } catch (err) {
      setNotices((current) => ({
        ...current,
        [sub.id]: { kind: "error", text: err instanceof Error ? err.message : "Sending the test failed." },
      }));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
      <Card>
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-ink">My Subscriptions</h2>
          <button
            type="button"
            onClick={() => openForm("")}
            className="rounded-lg bg-slate-950 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-slate-800 dark:bg-white dark:text-slate-950 dark:hover:bg-slate-200"
          >
            New subscription
          </button>
        </div>

        {error ? (
          <p role="alert" className="mt-3 text-sm text-rose-600 dark:text-rose-400">
            {error}
          </p>
        ) : null}

        <div className="mt-4 space-y-3">
          {items.map((sub) => (
            <article
              key={sub.id}
              className="rounded-xl border border-line bg-white/70 p-3 dark:bg-white/5"
            >
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={channelTone(sub.channel)}>{sub.channel}</Badge>
                {sub.severities.length > 0 ? (
                  sub.severities.map((s) => (
                    <Badge key={s} tone="neutral">
                      {s}
                    </Badge>
                  ))
                ) : (
                  <Badge tone="neutral">ALL SEVERITIES</Badge>
                )}
                {!sub.enabled && <Badge tone="neutral">DISABLED</Badge>}
              </div>
              <p className="mt-2 text-sm font-medium text-ink">{subscriptionRuleLabel(sub)}</p>
              <p className="mt-1 text-xs text-muted">Created {formatDate(sub.createdAt)}</p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <label className="flex items-center gap-1.5 text-xs text-ink">
                  <input
                    type="checkbox"
                    checked={sub.enabled}
                    disabled={busyId === sub.id}
                    onChange={() => void toggleEnabled(sub)}
                    aria-label={`Enabled: ${sub.channel} subscription for ${targetDescription(sub)}`}
                  />
                  Enabled
                </label>
                {sub.channel !== "EMAIL" ? (
                  <button
                    type="button"
                    disabled={busyId === sub.id}
                    onClick={() => void sendTest(sub)}
                    aria-label={`Send test notification: ${sub.channel} subscription for ${targetDescription(sub)}`}
                    className={buttonClass}
                  >
                    Send test
                  </button>
                ) : null}
                <button
                  type="button"
                  disabled={busyId === sub.id}
                  onClick={() => void remove(sub)}
                  aria-label={`Delete ${sub.channel} subscription for ${targetDescription(sub)}`}
                  className={buttonClass}
                >
                  Delete
                </button>
              </div>
              {notices[sub.id] ? (
                <p
                  role={notices[sub.id].kind === "error" ? "alert" : "status"}
                  className={`mt-2 text-xs ${
                    notices[sub.id].kind === "error" ? "text-rose-600 dark:text-rose-400" : "text-muted"
                  }`}
                >
                  {notices[sub.id].text}
                </p>
              ) : null}
            </article>
          ))}
          {items.length === 0 && (
            <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-line bg-white/50 p-8 text-center dark:bg-white/5">
              <p className="text-sm font-medium text-ink">No subscriptions yet</p>
              <p className="max-w-xs text-sm text-muted">
                Get a Slack, Microsoft Teams or webhook message when a rule opens an incident.
              </p>
              <button
                type="button"
                onClick={() => openForm("")}
                className="rounded-lg bg-slate-950 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-slate-800 dark:bg-white dark:text-slate-950 dark:hover:bg-slate-200"
              >
                Create your first subscription
              </button>
            </div>
          )}
        </div>
      </Card>

      <Card>
        <h2 className="text-lg font-semibold text-ink">Available Rules</h2>
        <p className="mt-1 text-xs text-muted">Subscribe to specific rules or to all rules in your team.</p>
        <div className="mt-4 space-y-2">
          {rules.map((rule) => (
            <article
              key={rule.id}
              className="rounded-xl border border-line bg-white/70 p-3 dark:bg-white/5"
            >
              <p className="text-sm font-medium text-ink">{rule.name}</p>
              <p className="mt-0.5 text-xs text-muted">{rule.description ?? "No description"}</p>
              <p className="mt-1 font-mono text-xs text-muted">Threshold: {rule.threshold}</p>
              <button
                type="button"
                onClick={() => openForm(rule.id)}
                aria-label={`Subscribe to ${rule.name}`}
                className={`mt-2 ${buttonClass}`}
              >
                Subscribe
              </button>
            </article>
          ))}
          {rules.length === 0 && (
            <p className="py-4 text-center text-sm text-muted">No alert rules configured yet.</p>
          )}
        </div>
      </Card>

      <SubscriptionForm
        open={formOpen}
        rules={rules}
        initialRuleId={formRuleId}
        teamId={teamId}
        onClose={closeForm}
        onSubmit={create}
      />
      <Dialog {...dialog.dialogProps} confirmLabel="Delete" cancelLabel="Cancel" />
    </div>
  );
}
