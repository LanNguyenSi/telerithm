"use client";

import clsx from "clsx";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

interface SelectProps {
  options: SelectOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  name?: string;
  id?: string;
  className?: string;
  buttonClassName?: string;
  listClassName?: string;
}

export function Select({
  options,
  value,
  onChange,
  placeholder = "Select an option",
  disabled = false,
  name,
  id,
  className,
  buttonClassName,
  listClassName,
}: SelectProps) {
  const reactId = useId();
  const buttonId = id ?? `select-${reactId}`;
  const listboxId = `${buttonId}-listbox`;
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const listboxRef = useRef<HTMLDivElement>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const [dropdownStyle, setDropdownStyle] = useState<React.CSSProperties>({});
  const [mounted, setMounted] = useState(false);

  useEffect(() => { setMounted(true); }, []);

  const selectedOption = useMemo(() => options.find((option) => option.value === value), [options, value]);

  // Position dropdown relative to button
  useEffect(() => {
    if (!isOpen || !buttonRef.current) return;
    const rect = buttonRef.current.getBoundingClientRect();
    setDropdownStyle({
      position: "fixed",
      top: rect.bottom + 4,
      left: rect.left,
      width: rect.width,
      zIndex: 9999,
    });
  }, [isOpen]);

  useEffect(() => {
    function handlePointerDown(event: MouseEvent) {
      const target = event.target as Node;
      if (
        !containerRef.current?.contains(target) &&
        !listboxRef.current?.contains(target)
      ) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    const selectedIndex = options.findIndex((option) => option.value === value && !option.disabled);
    const firstEnabledIndex = options.findIndex((option) => !option.disabled);
    setFocusedIndex(selectedIndex >= 0 ? selectedIndex : firstEnabledIndex);
  }, [isOpen, options, value]);

  useEffect(() => {
    if (!isOpen || focusedIndex < 0) return;
    const optionElement = listboxRef.current?.children[focusedIndex] as HTMLElement | undefined;
    optionElement?.scrollIntoView({ block: "nearest" });
  }, [focusedIndex, isOpen]);

  function commitSelection(nextValue: string, nextDisabled?: boolean) {
    if (disabled || nextDisabled) return;
    onChange(nextValue);
    setIsOpen(false);
  }

  function moveFocus(direction: 1 | -1) {
    if (options.length === 0) return;
    const startIndex = focusedIndex >= 0 ? focusedIndex : direction > 0 ? -1 : options.length;
    let nextIndex = startIndex;
    do {
      nextIndex += direction;
    } while (nextIndex >= 0 && nextIndex < options.length && options[nextIndex]?.disabled);
    if (nextIndex >= 0 && nextIndex < options.length) {
      setFocusedIndex(nextIndex);
    }
  }

  const dropdown = isOpen && mounted ? createPortal(
    <div
      id={listboxId}
      ref={listboxRef}
      role="listbox"
      aria-labelledby={buttonId}
      tabIndex={-1}
      style={dropdownStyle}
      className={clsx(
        "max-h-60 overflow-y-auto rounded-xl border border-line bg-white/95 p-1 shadow-2xl backdrop-blur dark:bg-slate-900/95",
        listClassName,
      )}
    >
      {options.length === 0 ? (
        <div className="px-3 py-2 text-sm text-muted">No options</div>
      ) : (
        options.map((option, index) => {
          const isSelected = option.value === value;
          const isFocused = index === focusedIndex;
          return (
            <button
              key={option.value}
              type="button"
              role="option"
              aria-selected={isSelected}
              disabled={option.disabled}
              onMouseEnter={() => { if (!option.disabled) setFocusedIndex(index); }}
              onClick={() => commitSelection(option.value, option.disabled)}
              className={clsx(
                "flex w-full items-center rounded-lg px-3 py-2 text-left text-sm transition",
                option.disabled && "cursor-not-allowed text-muted/60",
                !option.disabled && "text-ink",
                isFocused && !option.disabled && "bg-slate-100 dark:bg-white/10",
                isSelected && !option.disabled && "bg-sky-50 text-sky-700 dark:bg-cyan-400/10 dark:text-cyan-300",
              )}
            >
              <span className={clsx("truncate", isSelected && "font-medium")}>{option.label}</span>
            </button>
          );
        })
      )}
    </div>,
    document.body,
  ) : null;

  return (
    <div ref={containerRef} className={clsx("relative w-full", className)}>
      {name ? <input type="hidden" name={name} value={value} /> : null}

      <button
        ref={buttonRef}
        id={buttonId}
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-controls={listboxId}
        aria-expanded={isOpen}
        onClick={() => { if (!disabled) setIsOpen((open) => !open); }}
        onKeyDown={(event) => {
          if (disabled) return;
          switch (event.key) {
            case "ArrowDown":
              event.preventDefault();
              if (!isOpen) setIsOpen(true);
              else moveFocus(1);
              break;
            case "ArrowUp":
              event.preventDefault();
              if (!isOpen) setIsOpen(true);
              else moveFocus(-1);
              break;
            case "Enter":
            case " ":
              event.preventDefault();
              if (!isOpen) { setIsOpen(true); }
              else if (focusedIndex >= 0) {
                const option = options[focusedIndex];
                if (option) commitSelection(option.value, option.disabled);
              }
              break;
            case "Escape":
              if (isOpen) { event.preventDefault(); setIsOpen(false); }
              break;
          }
        }}
        className={clsx(
          "flex w-full items-center justify-between rounded-lg border border-line bg-white px-3 py-2 text-left text-sm text-ink outline-none transition",
          "focus:border-slate-400 focus:ring-2 focus:ring-slate-400/20 dark:bg-white/10",
          disabled && "cursor-not-allowed opacity-50",
          buttonClassName,
        )}
      >
        <span className={clsx("block truncate", !selectedOption && "text-muted")}>
          {selectedOption?.label ?? placeholder}
        </span>
        <svg
          aria-hidden="true"
          viewBox="0 0 20 20"
          fill="none"
          className={clsx("ml-2 h-4 w-4 shrink-0 text-muted transition", isOpen && "rotate-180")}
        >
          <path d="M5 7.5L10 12.5L15 7.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {dropdown}
    </div>
  );
}
