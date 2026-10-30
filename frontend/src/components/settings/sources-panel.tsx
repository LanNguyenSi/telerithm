"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { createSource, deleteSource, renameSource, rotateSourceKey } from "@/lib/api/client";
import { canManageSources, canWriteTeam } from "@/lib/auth/roles";
import { SOURCE_TYPES, type Source, type SourceType, type TeamRole } from "@/types";

const inputClass =
  "mt-1 w-full rounded-lg border border-line bg-transparent px-3 py-2 text-sm text-ink outline-hidden focus:border-slate-400 dark:focus:border-slate-500";

const rowButtonClass =
  "rounded-lg border border-line px-2.5 py-1 text-xs text-ink transition hover:border-slate-400 disabled:opacity-50";

/** Keys shorter than this reveal too much of themselves when only partly masked. */
const MIN_PARTIALLY_MASKED_LENGTH = 12;

/** Upper bound on the visible prefix, so a long prefix cannot expose the key. */
const MAX_MASKED_PREFIX_LENGTH = 8;

/** How long a row keeps the "Copied" label before it falls back to "Copy". */
const COPIED_RESET_MS = 2000;

/**
 * Masks an ingest key for the list: the prefix through the first underscore
 * (at most 8 characters), then `****`, then the last four characters
 * (e.g. `tlm_****a7c1`). A key shorter than 12 characters is masked whole
 * (`****`), because 8 prefix characters plus 4 tail characters would leave
 * little of a short key hidden.
 */
function maskApiKey(apiKey: string): string {
  if (apiKey.length < MIN_PARTIALLY_MASKED_LENGTH) return "****";
  const underscore = apiKey.indexOf("_");
  const prefix =
    underscore >= 0 ? apiKey.slice(0, Math.min(underscore + 1, MAX_MASKED_PREFIX_LENGTH)) : "";
  return `${prefix}****${apiKey.slice(-4)}`;
}

/**
 * A listed source's key, masked until the row's Reveal toggle is pressed. The
 * row lives as long as the page, so its copy feedback is transient ("Copied"
 * reverts on a timer) and single sided (a failing copy clears "Copied" and
 * clears the stale error before each write). A rotation hands this same
 * instance the new key, so revealing, copying and errors reset with it.
 */
function SourceKey({ name, apiKey }: { name: string; apiKey: string }) {
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setRevealed(false);
    setCopied(false);
    setError(null);
  }, [apiKey]);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), COPIED_RESET_MS);
    return () => clearTimeout(timer);
  }, [copied]);

  const copyKey = async () => {
    setError(null);
    try {
      await navigator.clipboard.writeText(apiKey);
      setCopied(true);
    } catch {
      setCopied(false);
      setError("Copy failed. Select the key and copy it manually.");
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2 self-start sm:self-auto">
      <span
        data-testid="source-api-key"
        className="rounded-full bg-cyan-100 px-3 py-1 font-mono text-xs text-cyan-800 dark:bg-cyan-900/30 dark:text-cyan-300"
      >
        {revealed ? apiKey : maskApiKey(apiKey)}
      </span>
      <button
        type="button"
        onClick={() => setRevealed((value) => !value)}
        aria-pressed={revealed}
        aria-label={`${revealed ? "Hide" : "Reveal"} API key of ${name}`}
        className={rowButtonClass}
      >
        {revealed ? "Hide" : "Reveal"}
      </button>
      <button
        type="button"
        onClick={() => void copyKey()}
        aria-label={`${copied ? "Copied" : "Copy"} API key of ${name}`}
        className={rowButtonClass}
      >
        {copied ? "Copied" : "Copy"}
      </button>
      <p role="status" aria-live="polite" data-testid="source-key-status" className="sr-only">
        {error ?? (copied ? "Copied" : "")}
      </p>
      {error ? (
        <p role="alert" className="w-full text-xs text-rose-600 dark:text-rose-400">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** A key shown exactly once, with a copy button. The page does not log or store it. */
function ShowOnceKey({
  intro,
  apiKey,
  testId,
  onDone,
}: {
  intro: ReactNode;
  apiKey: string | undefined;
  testId: string;
  onDone: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const copyKey = async () => {
    if (!apiKey) return;
    try {
      await navigator.clipboard.writeText(apiKey);
      setCopied(true);
    } catch {
      setError("Copy failed. Select the key and copy it manually.");
    }
  };

  return (
    <div className="mt-4 space-y-3">
      <p className="text-sm text-muted">{intro}</p>
      <code
        data-testid={testId}
        className="block break-all rounded-lg border border-line bg-slate-900/5 px-3 py-2 font-mono text-xs text-ink dark:bg-white/5"
      >
        {apiKey}
      </code>
      {error ? (
        <p role="alert" className="text-sm text-rose-600 dark:text-rose-400">
          {error}
        </p>
      ) : null}
      <div className="flex items-center justify-end gap-3">
        <button
          type="button"
          onClick={() => void copyKey()}
          className="rounded-lg border border-line px-3 py-1.5 text-sm text-ink transition hover:border-slate-400"
        >
          {copied ? "Copied" : "Copy key"}
        </button>
        <button
          type="button"
          onClick={onDone}
          className="rounded-lg bg-slate-950 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-slate-800 dark:bg-white dark:text-slate-950 dark:hover:bg-slate-200"
        >
          Done
        </button>
      </div>
    </div>
  );
}

/**
 * Log source list with a create dialog and, per source, rename, rotate key and
 * delete. The create dialog posts to the existing POST /sources and shows the
 * new source's API key once, with a copy button; a key rotation shows the new
 * key the same way. The key is not logged or stored by the page. The create
 * control is rendered only for roles that may write; the per-source controls
 * only for OWNER and ADMIN (the API refuses everyone else with 403 either way).
 * A listed key is shown masked (see maskApiKey); the full key enters the DOM
 * only while the row's Reveal toggle is pressed, and Copy puts it on the
 * clipboard without revealing it.
 */
export function SourcesPanel({
  sources,
  teamId,
  token,
  role,
}: {
  sources: Source[];
  teamId: string;
  token: string;
  role: TeamRole;
}) {
  const router = useRouter();
  const writable = canWriteTeam(role);
  const manageable = canManageSources(role);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [type, setType] = useState<SourceType>("HTTP");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<Source | null>(null);
  const [renaming, setRenaming] = useState<Source | null>(null);
  const [deleting, setDeleting] = useState<Source | null>(null);
  const [rotating, setRotating] = useState<Source | null>(null);
  const [rotated, setRotated] = useState<Source | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const openDialog = () => {
    setName("");
    setType("HTTP");
    setError(null);
    setCreated(null);
    setOpen(true);
  };

  const closeDialog = () => {
    const showedKey = created !== null;
    setOpen(false);
    setCreated(null);
    if (showedKey) router.refresh();
  };

  const submit = async () => {
    if (name.trim().length < 2) {
      setError("Name must be at least 2 characters.");
      return;
    }
    setPending(true);
    setError(null);
    try {
      const { source } = await createSource(token, { teamId, name: name.trim(), type });
      setCreated(source);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Creating the source failed.");
    } finally {
      setPending(false);
    }
  };

  const confirmRename = async (value: string) => {
    const target = renaming;
    setRenaming(null);
    if (!target) return;
    if (value.length < 2) {
      setActionError("Name must be at least 2 characters.");
      return;
    }
    setBusyId(target.id);
    setActionError(null);
    try {
      await renameSource(target.id, token, { name: value });
      router.refresh();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Renaming the source failed.");
    } finally {
      setBusyId(null);
    }
  };

  const confirmDelete = async () => {
    const target = deleting;
    setDeleting(null);
    if (!target) return;
    setBusyId(target.id);
    setActionError(null);
    try {
      await deleteSource(target.id, token);
      router.refresh();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Deleting the source failed.");
    } finally {
      setBusyId(null);
    }
  };

  const confirmRotate = async () => {
    const target = rotating;
    setRotating(null);
    if (!target) return;
    setBusyId(target.id);
    setActionError(null);
    try {
      const { source } = await rotateSourceKey(target.id, token);
      setRotated(source);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Rotating the key failed.");
    } finally {
      setBusyId(null);
    }
  };

  const closeRotated = () => {
    setRotated(null);
    router.refresh();
  };

  return (
    <Card>
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-ink">Log Sources</h2>
        {writable ? (
          <button
            type="button"
            onClick={openDialog}
            className="rounded-lg bg-slate-950 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-slate-800 dark:bg-white dark:text-slate-950 dark:hover:bg-slate-200"
          >
            New source
          </button>
        ) : null}
      </div>

      {actionError ? (
        <p role="alert" className="mt-3 text-sm text-rose-600 dark:text-rose-400">
          {actionError}
        </p>
      ) : null}

      {sources.length === 0 ? (
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
            <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
            <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
            <line x1="12" y1="22.08" x2="12" y2="12" />
          </svg>
          <p className="text-sm font-medium text-ink">No log sources configured</p>
          <p className="max-w-xs text-sm text-muted">
            {writable
              ? "Create a source with New source, then send logs with its API key."
              : "No sources exist for this team yet. Team members with write access can create them."}
          </p>
        </div>
      ) : (
        <div className="mt-4 space-y-3">
          {sources.map((source) => (
            <article
              key={source.id}
              className="rounded-xl border border-line bg-white/70 p-3 dark:bg-white/5"
            >
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm font-medium text-ink">{source.name}</p>
                  <p className="mt-0.5 text-xs text-muted">{source.type}</p>
                </div>
                {source.apiKey ? <SourceKey name={source.name} apiKey={source.apiKey} /> : null}
              </div>
              {manageable ? (
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    disabled={busyId === source.id}
                    onClick={() => setRenaming(source)}
                    aria-label={`Rename ${source.name}`}
                    className={rowButtonClass}
                  >
                    Rename
                  </button>
                  <button
                    type="button"
                    disabled={busyId === source.id}
                    onClick={() => setRotating(source)}
                    aria-label={`Rotate key of ${source.name}`}
                    className={rowButtonClass}
                  >
                    Rotate key
                  </button>
                  <button
                    type="button"
                    disabled={busyId === source.id}
                    onClick={() => setDeleting(source)}
                    aria-label={`Delete ${source.name}`}
                    className={`${rowButtonClass} text-rose-600 dark:text-rose-400`}
                  >
                    Delete
                  </button>
                </div>
              ) : null}
            </article>
          ))}
        </div>
      )}

      {writable && open ? (
        <div className="fixed inset-0 z-300 flex items-center justify-center bg-slate-950/40 px-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="create-source-title"
            className="w-full max-w-md rounded-2xl border border-line bg-white p-6 shadow-panel dark:bg-slate-900"
          >
            <h3 id="create-source-title" className="text-lg font-semibold text-ink">
              {created ? "Source created" : "New log source"}
            </h3>

            {created ? (
              <ShowOnceKey
                intro={
                  <>
                    Copy the API key for <span className="font-medium text-ink">{created.name}</span> now.
                    Send logs with it as the source credential.
                  </>
                }
                apiKey={created.apiKey}
                testId="new-source-api-key"
                onDone={closeDialog}
              />
            ) : (
              <>
                <div className="mt-4 space-y-4">
                  <div>
                    <label htmlFor="source-name" className="block text-sm text-muted">
                      Name
                    </label>
                    <input
                      id="source-name"
                      value={name}
                      maxLength={100}
                      onChange={(e) => setName(e.target.value)}
                      className={inputClass}
                    />
                  </div>
                  <div>
                    <label htmlFor="source-type" className="block text-sm text-muted">
                      Type
                    </label>
                    <select
                      id="source-type"
                      value={type}
                      onChange={(e) => setType(e.target.value as SourceType)}
                      className={inputClass}
                    >
                      {SOURCE_TYPES.map((value) => (
                        <option key={value} value={value}>
                          {value}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                {error ? (
                  <p role="alert" className="mt-4 text-sm text-rose-600 dark:text-rose-400">
                    {error}
                  </p>
                ) : null}
                <div className="mt-6 flex items-center justify-end gap-3">
                  <button
                    type="button"
                    onClick={() => setOpen(false)}
                    className="rounded-lg border border-line px-3 py-1.5 text-sm text-ink transition hover:border-slate-400"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => void submit()}
                    className="rounded-lg bg-slate-950 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-slate-800 disabled:opacity-50 dark:bg-white dark:text-slate-950 dark:hover:bg-slate-200"
                  >
                    {pending ? "Creating..." : "Create source"}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      ) : null}

      {manageable ? (
        <>
          <Dialog
            open={renaming !== null}
            variant="prompt"
            title={`Rename source "${renaming?.name ?? ""}"`}
            defaultValue={renaming?.name}
            maxLength={100}
            confirmLabel="Rename"
            cancelLabel="Cancel"
            onClose={() => setRenaming(null)}
            onConfirm={(value) => void confirmRename(value)}
          />
          <Dialog
            open={deleting !== null}
            variant="confirm"
            title={`Delete source "${deleting?.name ?? ""}"?`}
            description="The source and its API key are removed and senders using the key are rejected at once. Logs already stored are not deleted; they stay until the 30-day retention expires."
            confirmLabel="Delete"
            cancelLabel="Cancel"
            onClose={() => setDeleting(null)}
            onConfirm={() => void confirmDelete()}
          />
          <Dialog
            open={rotating !== null}
            variant="confirm"
            title={`Rotate the key of "${rotating?.name ?? ""}"?`}
            description="The current key stops working at once. Update every sender with the new key, which is shown only once."
            confirmLabel="Rotate key"
            cancelLabel="Cancel"
            onClose={() => setRotating(null)}
            onConfirm={() => void confirmRotate()}
          />
          {rotated ? (
            <div className="fixed inset-0 z-300 flex items-center justify-center bg-slate-950/40 px-4">
              <div
                role="dialog"
                aria-modal="true"
                aria-labelledby="rotated-source-title"
                className="w-full max-w-md rounded-2xl border border-line bg-white p-6 shadow-panel dark:bg-slate-900"
              >
                <h3 id="rotated-source-title" className="text-lg font-semibold text-ink">
                  Key rotated
                </h3>
                <ShowOnceKey
                  intro={
                    <>
                      Copy the new API key for <span className="font-medium text-ink">{rotated.name}</span>{" "}
                      now. The old key no longer works. After you close this dialog the key is shown masked to
                      owners and admins in the source list, where you can reveal or copy it.
                    </>
                  }
                  apiKey={rotated.apiKey}
                  testId="rotated-source-api-key"
                  onDone={closeRotated}
                />
              </div>
            </div>
          ) : null}
        </>
      ) : null}
    </Card>
  );
}
