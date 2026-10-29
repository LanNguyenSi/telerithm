"use client";

import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import type { AlertRule } from "@/types";
import {
  buildSubscriptionPayload,
  CHANNEL_LABELS,
  SUBSCRIPTION_CHANNELS,
  SUBSCRIPTION_SEVERITIES,
  URL_LABELS,
  type SubscriptionChannel,
  type SubscriptionFieldName,
  type SubscriptionPayload,
} from "./subscription-input";

const inputClass =
  "mt-1 w-full rounded-lg border border-line bg-transparent px-3 py-2 text-sm text-ink outline-hidden focus:border-slate-400 dark:focus:border-slate-500";

const FOCUSABLE = "input:not([disabled]), select:not([disabled]), button:not([disabled]), textarea:not([disabled])";

/**
 * Create dialog for an alert subscription. The caller does the POST; a rejection
 * is shown in the dialog with the API's own message. Escape and Cancel close it,
 * Tab stays inside it, and focus returns to the control that opened it.
 */
export function SubscriptionForm({
  open,
  rules,
  initialRuleId,
  teamId,
  onClose,
  onSubmit,
}: {
  open: boolean;
  rules: AlertRule[];
  /** Rule preselected when the dialog opens; empty means all rules in the team. */
  initialRuleId: string;
  teamId: string;
  onClose: () => void;
  onSubmit: (payload: SubscriptionPayload) => Promise<void>;
}) {
  const [ruleId, setRuleId] = useState("");
  const [channel, setChannel] = useState<SubscriptionChannel>("WEBHOOK");
  const [url, setUrl] = useState("");
  const [secret, setSecret] = useState("");
  const [severities, setSeverities] = useState<string[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<{ field: SubscriptionFieldName | null; message: string } | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setRuleId(initialRuleId);
    setChannel("WEBHOOK");
    setUrl("");
    setSecret("");
    setSeverities([]);
    setPending(false);
    setError(null);
    dialogRef.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus();
    return () => {
      returnFocusRef.current?.focus();
    };
  }, [open, initialRuleId]);

  useEffect(() => {
    if (!open) return;
    const handleKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [open, onClose]);

  if (!open) return null;

  const urlLabel = URL_LABELS[channel];

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (pending) return;
    const result = buildSubscriptionPayload(teamId, { ruleId, channel, url, secret, severities }, rules.map((r) => r.id));
    if (!result.ok) {
      setError({ field: result.field, message: result.message });
      return;
    }
    setPending(true);
    setError(null);
    try {
      await onSubmit(result.payload);
      onClose();
    } catch (err) {
      setError({ field: null, message: err instanceof Error ? err.message : "Creating the subscription failed." });
    } finally {
      setPending(false);
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Tab") return;
    const items = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []);
    if (items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const toggleSeverity = (level: string) =>
    setSeverities((current) => (current.includes(level) ? current.filter((l) => l !== level) : [...current, level]));

  const urlInvalid = error?.field === "url";

  return (
    <div className="fixed inset-0 z-300 flex items-center justify-center bg-slate-950/40 px-4">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="subscription-form-title"
        onKeyDown={onKeyDown}
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-line bg-white p-6 shadow-panel dark:bg-slate-900"
      >
        <h3 id="subscription-form-title" className="text-lg font-semibold text-ink">
          New subscription
        </h3>
        <p className="mt-1 text-sm text-muted">
          Get a message in a channel when a rule opens an incident. The subscription is yours; it does not notify other
          team members.
        </p>

        <form onSubmit={submit} noValidate className="mt-5">
          <div className="space-y-4">
            <div>
              <label htmlFor="subscription-rule" className="block text-sm text-muted">
                Rule
              </label>
              <select
                id="subscription-rule"
                value={ruleId}
                onChange={(e) => setRuleId(e.target.value)}
                aria-invalid={error?.field === "ruleId" ? true : undefined}
                className={inputClass}
              >
                <option value="">All rules in the team</option>
                {rules.map((rule) => (
                  <option key={rule.id} value={rule.id}>
                    {rule.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="subscription-channel" className="block text-sm text-muted">
                Channel
              </label>
              <select
                id="subscription-channel"
                value={channel}
                onChange={(e) => setChannel(e.target.value as SubscriptionChannel)}
                className={inputClass}
              >
                {SUBSCRIPTION_CHANNELS.map((value) => (
                  <option key={value} value={value}>
                    {CHANNEL_LABELS[value]}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs text-muted">Email is not available yet because no mail transport is configured.</p>
            </div>

            <div>
              <label htmlFor="subscription-url" className="block text-sm text-muted">
                {urlLabel}
              </label>
              <input
                id="subscription-url"
                type="url"
                inputMode="url"
                autoComplete="off"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://hooks.example.com/..."
                aria-invalid={urlInvalid ? true : undefined}
                aria-describedby="subscription-url-hint"
                className={inputClass}
              />
              <p id="subscription-url-hint" className="mt-1 text-xs text-muted">
                Must be a public http or https address. Private, loopback and link-local hosts are refused.
              </p>
            </div>

            {channel === "WEBHOOK" ? (
              <div>
                <label htmlFor="subscription-secret" className="block text-sm text-muted">
                  Signing secret (optional)
                </label>
                <input
                  id="subscription-secret"
                  type="password"
                  autoComplete="off"
                  value={secret}
                  onChange={(e) => setSecret(e.target.value)}
                  aria-describedby="subscription-secret-hint"
                  className={inputClass}
                />
                <p id="subscription-secret-hint" className="mt-1 text-xs text-muted">
                  With a secret, each request carries an X-Telerithm-Signature header (HMAC-SHA256 of the body).
                </p>
              </div>
            ) : null}

            <fieldset>
              <legend className="block text-sm text-muted">Severities</legend>
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-2">
                {SUBSCRIPTION_SEVERITIES.map((level) => (
                  <label key={level} className="flex items-center gap-1.5 text-sm text-ink">
                    <input type="checkbox" checked={severities.includes(level)} onChange={() => toggleSeverity(level)} />
                    {level}
                  </label>
                ))}
              </div>
              <p className="mt-1 text-xs text-muted">Leave all unchecked to be notified for every severity.</p>
            </fieldset>
          </div>

          {error ? (
            <p role="alert" className="mt-4 text-sm text-rose-600 dark:text-rose-400">
              {error.message}
            </p>
          ) : null}

          <div className="mt-6 flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-line px-3 py-1.5 text-sm text-ink transition hover:border-slate-400"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={pending}
              className="rounded-lg bg-slate-950 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-slate-800 disabled:opacity-50 dark:bg-white dark:text-slate-950 dark:hover:bg-slate-200"
            >
              {pending ? "Creating..." : "Create subscription"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
