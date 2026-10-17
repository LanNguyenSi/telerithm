"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/card";
import { createSource } from "@/lib/api/client";
import { canWriteTeam } from "@/lib/auth/roles";
import { SOURCE_TYPES, type Source, type SourceType, type TeamRole } from "@/types";

const inputClass =
  "mt-1 w-full rounded-lg border border-line bg-transparent px-3 py-2 text-sm text-ink outline-hidden focus:border-slate-400 dark:focus:border-slate-500";

/**
 * Log source list with a create dialog. The dialog posts to the existing
 * POST /sources and shows the new source's API key once, with a copy button;
 * the key is not logged or stored by the page. The create control is rendered
 * only for roles that may write.
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
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [type, setType] = useState<SourceType>("HTTP");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<Source | null>(null);
  const [copied, setCopied] = useState(false);

  const openDialog = () => {
    setName("");
    setType("HTTP");
    setError(null);
    setCreated(null);
    setCopied(false);
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

  const copyKey = async () => {
    if (!created?.apiKey) return;
    try {
      await navigator.clipboard.writeText(created.apiKey);
      setCopied(true);
    } catch {
      setError("Copy failed. Select the key and copy it manually.");
    }
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
            <article key={source.id} className="rounded-xl border border-line bg-white/70 p-3 dark:bg-white/5">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm font-medium text-ink">{source.name}</p>
                  <p className="mt-0.5 text-xs text-muted">{source.type}</p>
                </div>
                {source.apiKey ? (
                  <span className="self-start rounded-full bg-cyan-100 px-3 py-1 font-mono text-xs text-cyan-800 dark:bg-cyan-900/30 dark:text-cyan-300 sm:self-auto">
                    {source.apiKey}
                  </span>
                ) : null}
              </div>
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
              <div className="mt-4 space-y-3">
                <p className="text-sm text-muted">
                  Copy the API key for <span className="font-medium text-ink">{created.name}</span> now. Send logs
                  with it as the source credential.
                </p>
                <code
                  data-testid="new-source-api-key"
                  className="block break-all rounded-lg border border-line bg-slate-900/5 px-3 py-2 font-mono text-xs text-ink dark:bg-white/5"
                >
                  {created.apiKey}
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
                    onClick={closeDialog}
                    className="rounded-lg bg-slate-950 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-slate-800 dark:bg-white dark:text-slate-950 dark:hover:bg-slate-200"
                  >
                    Done
                  </button>
                </div>
              </div>
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
    </Card>
  );
}
