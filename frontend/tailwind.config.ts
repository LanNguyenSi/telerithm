import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "var(--color-ink)",
        muted: "var(--color-muted)",
        paper: "var(--color-paper)",
        signal: "var(--color-signal)",
        danger: "var(--color-danger)",
        panel: "var(--color-panel)",
        line: "var(--color-line)",
      },
      fontFamily: {
        sans: ["var(--font-space-grotesk)"],
        mono: ["var(--font-ibm-plex-mono)"],
      },
      boxShadow: {
        panel: "0 18px 50px rgba(15, 23, 42, 0.14)",
        "panel-dark": "0 8px 24px rgba(0, 0, 0, 0.35)",
      },
    },
  },
  plugins: [],
};

export default config;

