"use client";

import { useEffect, useState } from "react";
import { ALERT_CONDITIONS, type AlertRule, type AlertRuleInput, type EditableAlertCondition } from "@/types";

const CONDITION_LABELS: Record<EditableAlertCondition, string> = {
  GREATER_THAN: "Count is greater than the threshold",
  LESS_THAN: "Count is less than the threshold",
  EQUALS: "Count equals the threshold",
  CHANGES_BY: "Count changes by the threshold",
};

const inputClass =
  "mt-1 w-full rounded-lg border border-line bg-transparent px-3 py-2 text-sm text-ink outline-hidden focus:border-slate-400 dark:focus:border-slate-500";

/**
 * Create / edit dialog for an alert rule. `rule` is null for a new rule.
 * onSubmit receives the full form state; the caller decides POST or PUT and
 * rejects with an Error whose message is shown in the dialog.
 */
export function AlertRuleForm({
  open,
  rule,
  onClose,
  onSubmit,
}: {
  open: boolean;
  rule: AlertRule | null;
  onClose: () => void;
  onSubmit: (input: AlertRuleInput) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [query, setQuery] = useState("");
  const [condition, setCondition] = useState<EditableAlertCondition>("GREATER_THAN");
  const [threshold, setThreshold] = useState("1");
  const [windowMinutes, setWindowMinutes] = useState("5");
  const [enabled, setEnabled] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A stored ANOMALY_DETECTED rule cannot be re-saved with that condition (the
  // API rejects it), so the form asks for one of the supported conditions.
  const legacyCondition = rule !== null && !ALERT_CONDITIONS.includes(rule.condition as EditableAlertCondition);

  useEffect(() => {
    if (!open) return;
    setName(rule?.name ?? "");
    setDescription(rule?.description ?? "");
    setQuery(rule?.query ?? "");
    setCondition(rule && !legacyCondition ? (rule.condition as EditableAlertCondition) : "GREATER_THAN");
    setThreshold(String(rule?.threshold ?? 1));
    setWindowMinutes(String(rule?.windowMinutes ?? 5));
    setEnabled(rule?.enabled ?? true);
    setPending(false);
    setError(null);
  }, [open, rule, legacyCondition]);

  if (!open) return null;

  const submit = async () => {
    const thresholdValue = Number(threshold);
    const windowValue = Number(windowMinutes);
    if (name.trim().length < 2) return setError("Name must be at least 2 characters.");
    if (!query.trim()) return setError("Query text is required.");
    if (!Number.isInteger(thresholdValue) || thresholdValue < 0) {
      return setError("Threshold must be a whole number, 0 or more.");
    }
    if (!Number.isInteger(windowValue) || windowValue < 1 || windowValue > 1440) {
      return setError("Window must be a whole number of minutes from 1 to 1440.");
    }
    setPending(true);
    setError(null);
    try {
      await onSubmit({
        name: name.trim(),
        description: description.trim() || undefined,
        query: query.trim(),
        condition,
        threshold: thresholdValue,
        windowMinutes: windowValue,
        enabled,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Saving the rule failed.");
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="fixed inset-0 z-300 flex items-center justify-center bg-slate-950/40 px-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="alert-rule-form-title"
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-line bg-white p-6 shadow-panel dark:bg-slate-900"
      >
        <h3 id="alert-rule-form-title" className="text-lg font-semibold text-ink">
          {rule ? "Edit alert rule" : "New alert rule"}
        </h3>
        <p className="mt-1 text-sm text-muted">
          The rule counts log messages that contain the query text within the window and opens an incident when the
          condition holds.
        </p>

        <div className="mt-5 space-y-4">
          <div>
            <label htmlFor="rule-name" className="block text-sm text-muted">
              Name
            </label>
            <input id="rule-name" value={name} onChange={(e) => setName(e.target.value)} className={inputClass} />
          </div>
          <div>
            <label htmlFor="rule-description" className="block text-sm text-muted">
              Description (optional)
            </label>
            <input
              id="rule-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className={inputClass}
            />
          </div>
          <div>
            <label htmlFor="rule-query" className="block text-sm text-muted">
              Query text
            </label>
            <input
              id="rule-query"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="e.g. connection timeout"
              className={inputClass}
            />
            <p className="mt-1 text-xs text-muted">Matched as a substring of the log message.</p>
          </div>
          <div>
            <label htmlFor="rule-condition" className="block text-sm text-muted">
              Condition
            </label>
            <select
              id="rule-condition"
              value={condition}
              onChange={(e) => setCondition(e.target.value as EditableAlertCondition)}
              className={inputClass}
            >
              {ALERT_CONDITIONS.map((value) => (
                <option key={value} value={value}>
                  {CONDITION_LABELS[value]}
                </option>
              ))}
            </select>
            {legacyCondition ? (
              <p className="mt-1 text-xs text-muted">
                This rule uses {rule?.condition}, which is no longer supported. Pick a condition to save it.
              </p>
            ) : null}
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="rule-threshold" className="block text-sm text-muted">
                Threshold
              </label>
              <input
                id="rule-threshold"
                type="number"
                min={0}
                step={1}
                value={threshold}
                onChange={(e) => setThreshold(e.target.value)}
                className={inputClass}
              />
            </div>
            <div>
              <label htmlFor="rule-window" className="block text-sm text-muted">
                Window (minutes)
              </label>
              <input
                id="rule-window"
                type="number"
                min={1}
                max={1440}
                step={1}
                value={windowMinutes}
                onChange={(e) => setWindowMinutes(e.target.value)}
                className={inputClass}
              />
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm text-ink">
            <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
            Enabled
          </label>
        </div>

        {error ? (
          <p role="alert" className="mt-4 text-sm text-rose-600 dark:text-rose-400">
            {error}
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
            type="button"
            disabled={pending}
            onClick={submit}
            className="rounded-lg bg-slate-950 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-slate-800 disabled:opacity-50 dark:bg-white dark:text-slate-950 dark:hover:bg-slate-200"
          >
            {pending ? "Saving..." : rule ? "Save changes" : "Create rule"}
          </button>
        </div>
      </div>
    </div>
  );
}
