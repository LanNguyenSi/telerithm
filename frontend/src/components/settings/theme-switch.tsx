"use client";

import { useEffect, useState } from "react";

export function ThemeSwitch() {
  const [dark, setDark] = useState(true);

  useEffect(() => {
    setDark(document.documentElement.classList.contains("dark"));
  }, []);

  function select(mode: "dark" | "light") {
    const isDark = mode === "dark";
    setDark(isDark);
    document.documentElement.classList.toggle("dark", isDark);
    localStorage.setItem("theme", mode);
  }

  return (
    <div className="flex gap-2">
      <button
        type="button"
        onClick={() => select("light")}
        className={`flex items-center gap-2 rounded-xl border px-4 py-2.5 text-sm transition ${
          !dark
            ? "border-signal bg-signal/10 font-medium text-signal"
            : "border-line text-muted hover:border-slate-400 hover:text-ink"
        }`}
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="5" />
          <line x1="12" y1="1" x2="12" y2="3" />
          <line x1="12" y1="21" x2="12" y2="23" />
          <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
          <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
          <line x1="1" y1="12" x2="3" y2="12" />
          <line x1="21" y1="12" x2="23" y2="12" />
          <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
          <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
        </svg>
        Light
      </button>
      <button
        type="button"
        onClick={() => select("dark")}
        className={`flex items-center gap-2 rounded-xl border px-4 py-2.5 text-sm transition ${
          dark
            ? "border-signal bg-signal/10 font-medium text-signal"
            : "border-line text-muted hover:border-slate-400 hover:text-ink"
        }`}
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
        </svg>
        Dark
      </button>
    </div>
  );
}
