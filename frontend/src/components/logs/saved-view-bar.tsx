"use client";

import { Card } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import type { SavedLogView } from "@/types";

export function SavedViewBar({
  views,
  selectedId,
  unsaved,
  loading,
  onSelect,
  onSave,
  onOverwrite,
  onDuplicate,
  onRename,
  onDelete,
  onSetDefault,
}: {
  views: SavedLogView[];
  selectedId: string;
  unsaved: boolean;
  loading: boolean;
  onSelect: (id: string) => void;
  onSave: () => void;
  onOverwrite: () => void;
  onDuplicate: () => void;
  onRename: () => void;
  onDelete: () => void;
  onSetDefault: () => void;
}) {
  const selected = views.find((view) => view.id === selectedId) ?? null;

  return (
    <Card className="flex flex-wrap items-center gap-2">
      <p className="text-xs uppercase tracking-[0.16em] text-muted">Saved Views</p>
      <Select
        value={selectedId}
        onChange={onSelect}
        disabled={loading}
        placeholder="Select saved view"
        className="min-w-60"
        options={views.map((view) => ({
          value: view.id,
          label: `${view.name}${view.isDefault ? " (default)" : ""}${view.isShared ? " [shared]" : " [private]"}`,
        }))}
      />
      {unsaved && selected ? (
        <span className="text-xs font-medium text-amber-700">Unsaved changes</span>
      ) : null}
      <div className="ml-auto flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onSave}
          className="rounded-md border border-line px-2 py-1 text-xs text-ink hover:bg-slate-900/5 dark:hover:bg-white/5"
        >
          Save New
        </button>
        <button
          type="button"
          onClick={onOverwrite}
          disabled={!selected}
          className="rounded-md border border-line px-2 py-1 text-xs text-ink hover:bg-slate-900/5 disabled:opacity-50 dark:hover:bg-white/5"
        >
          Overwrite
        </button>
        <button
          type="button"
          onClick={onDuplicate}
          disabled={!selected}
          className="rounded-md border border-line px-2 py-1 text-xs text-ink hover:bg-slate-900/5 disabled:opacity-50 dark:hover:bg-white/5"
        >
          Duplicate
        </button>
        <button
          type="button"
          onClick={onRename}
          disabled={!selected}
          className="rounded-md border border-line px-2 py-1 text-xs text-ink hover:bg-slate-900/5 disabled:opacity-50 dark:hover:bg-white/5"
        >
          Rename
        </button>
        <button
          type="button"
          onClick={onSetDefault}
          disabled={!selected}
          className="rounded-md border border-line px-2 py-1 text-xs text-ink hover:bg-slate-900/5 disabled:opacity-50 dark:hover:bg-white/5"
        >
          Set Default
        </button>
        <button
          type="button"
          onClick={onDelete}
          disabled={!selected}
          className="rounded-md border border-rose-300 px-2 py-1 text-xs text-rose-700 hover:bg-rose-50 disabled:opacity-50 dark:border-rose-900/40 dark:hover:bg-rose-900/20"
        >
          Delete
        </button>
      </div>
    </Card>
  );
}
