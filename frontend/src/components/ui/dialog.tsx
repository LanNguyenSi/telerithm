"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/* ------------------------------------------------------------------ */
/*  Dialog component                                                   */
/* ------------------------------------------------------------------ */

type DialogProps = {
  open: boolean;
  title: string;
  description?: string;
  onClose: () => void;
} & (
  | { variant: "confirm"; onConfirm: () => void }
  | {
      variant: "prompt";
      defaultValue?: string;
      onConfirm: (value: string) => void;
    }
  | {
      variant: "save-view";
      defaultName?: string;
      onConfirm: (data: { name: string; shared: boolean; isDefault: boolean }) => void;
    }
);

export function Dialog(props: DialogProps) {
  const { open, title, description, onClose } = props;
  const [inputValue, setInputValue] = useState("");
  const [shared, setShared] = useState(false);
  const [isDefault, setIsDefault] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    if (props.variant === "prompt") {
      setInputValue(props.defaultValue ?? "");
    } else if (props.variant === "save-view") {
      setInputValue(props.defaultName ?? "");
      setShared(false);
      setIsDefault(false);
    }
  }, [open, props.variant, props.variant === "prompt" ? props.defaultValue : undefined, props.variant === "save-view" ? props.defaultName : undefined]);

  useEffect(() => {
    if (open && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [open, onClose]);

  if (!open) return null;

  const handleConfirm = () => {
    if (props.variant === "confirm") {
      props.onConfirm();
    } else if (props.variant === "prompt") {
      if (!inputValue.trim()) return;
      props.onConfirm(inputValue.trim());
    } else if (props.variant === "save-view") {
      if (!inputValue.trim()) return;
      props.onConfirm({ name: inputValue.trim(), shared, isDefault });
    }
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-[300] flex items-center justify-center bg-slate-950/40 px-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="w-full max-w-sm rounded-2xl border border-line bg-white p-5 shadow-panel dark:bg-slate-900"
        role="dialog"
        aria-modal="true"
      >
        <h3 className="text-base font-semibold text-ink">{title}</h3>
        {description ? (
          <p className="mt-1 text-sm text-muted">{description}</p>
        ) : null}

        {props.variant === "prompt" ? (
          <input
            ref={inputRef}
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") handleConfirm(); }}
            className="mt-3 w-full rounded-lg border border-line bg-transparent px-3 py-2 text-sm text-ink outline-none focus:border-slate-400 dark:focus:border-slate-500"
          />
        ) : null}

        {props.variant === "save-view" ? (
          <div className="mt-3 space-y-3">
            <input
              ref={inputRef}
              type="text"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleConfirm(); }}
              placeholder="Name der Ansicht"
              className="w-full rounded-lg border border-line bg-transparent px-3 py-2 text-sm text-ink outline-none focus:border-slate-400 dark:focus:border-slate-500"
            />
            <label className="flex items-center gap-2 text-sm text-muted">
              <input
                type="checkbox"
                checked={shared}
                onChange={(e) => setShared(e.target.checked)}
                className="rounded border-line"
              />
              Team-weit teilen
            </label>
            <label className="flex items-center gap-2 text-sm text-muted">
              <input
                type="checkbox"
                checked={isDefault}
                onChange={(e) => setIsDefault(e.target.checked)}
                className="rounded border-line"
              />
              Als Standardansicht setzen
            </label>
          </div>
        ) : null}

        <div className="mt-4 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-line px-3 py-1.5 text-sm text-ink transition hover:border-slate-400"
          >
            Abbrechen
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            className="rounded-lg bg-slate-950 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-slate-800 dark:bg-white dark:text-slate-950 dark:hover:bg-slate-200"
          >
            {props.variant === "confirm" ? "Bestätigen" : "Speichern"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  useDialog hook — imperative API                                    */
/* ------------------------------------------------------------------ */

type DialogState =
  | { open: false }
  | ({ open: true } & (
      | { variant: "confirm"; title: string; description?: string; resolve: (ok: boolean) => void }
      | { variant: "prompt"; title: string; description?: string; defaultValue?: string; resolve: (value: string | null) => void }
      | { variant: "save-view"; title: string; description?: string; defaultName?: string; resolve: (data: { name: string; shared: boolean; isDefault: boolean } | null) => void }
    ));

export function useDialog() {
  const [state, setState] = useState<DialogState>({ open: false });

  const confirm = useCallback((title: string, description?: string): Promise<boolean> => {
    return new Promise((resolve) => {
      setState({ open: true, variant: "confirm", title, description, resolve });
    });
  }, []);

  const prompt = useCallback((title: string, defaultValue?: string): Promise<string | null> => {
    return new Promise((resolve) => {
      setState({ open: true, variant: "prompt", title, defaultValue, resolve });
    });
  }, []);

  const saveView = useCallback((title: string, defaultName?: string): Promise<{ name: string; shared: boolean; isDefault: boolean } | null> => {
    return new Promise((resolve) => {
      setState({ open: true, variant: "save-view", title, description: "Name und Optionen für die Ansicht festlegen.", defaultName, resolve });
    });
  }, []);

  const close = useCallback(() => {
    if (!state.open) return;
    if (state.variant === "confirm") state.resolve(false);
    else state.resolve(null);
    setState({ open: false });
  }, [state]);

  const dialogProps = state.open
    ? state.variant === "confirm"
      ? {
          open: true as const,
          variant: "confirm" as const,
          title: state.title,
          description: state.description,
          onClose: close,
          onConfirm: () => { state.resolve(true); setState({ open: false }); },
        }
      : state.variant === "prompt"
        ? {
            open: true as const,
            variant: "prompt" as const,
            title: state.title,
            description: state.description,
            defaultValue: state.defaultValue,
            onClose: close,
            onConfirm: (value: string) => { state.resolve(value); setState({ open: false }); },
          }
        : {
            open: true as const,
            variant: "save-view" as const,
            title: state.title,
            description: state.description,
            defaultName: state.defaultName,
            onClose: close,
            onConfirm: (data: { name: string; shared: boolean; isDefault: boolean }) => { state.resolve(data); setState({ open: false }); },
          }
    : { open: false as const, variant: "confirm" as const, title: "", onClose: () => {}, onConfirm: () => {} };

  return { confirm, prompt, saveView, dialogProps };
}
