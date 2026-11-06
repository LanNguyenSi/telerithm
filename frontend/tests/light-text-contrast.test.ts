import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const globalsCss = readFileSync(resolve(process.cwd(), "src/app/globals.css"), "utf8");

/** The light page background: `--color-paper` in the `:root { ... }` block. */
function lightPaper(): string {
  const block = /:root\s*\{([^}]*)\}/.exec(globalsCss)?.[1];
  if (!block) throw new Error("globals.css has no :root { ... } block");
  const value = /--color-paper:\s*(#[0-9a-fA-F]{6})/.exec(block)?.[1];
  if (!value) throw new Error("globals.css has no six digit hex :root --color-paper");
  return value.toLowerCase();
}

function relativeLuminance(hex: string): number {
  const rgb = parseInt(hex.slice(1), 16);
  const [red, green, blue] = [(rgb >> 16) & 0xff, (rgb >> 8) & 0xff, rgb & 0xff].map((channel) => {
    const srgb = channel / 255;
    return srgb <= 0.03928 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function contrastRatio(a: string, b: string): number {
  const first = relativeLuminance(a);
  const second = relativeLuminance(b);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

const AA_BODY_TEXT = 4.5;

// Tailwind v4 palette values behind the light-scheme classes used by levelTone
// and the log-table expand hint.
const AMBER_700 = "#b45309"; // text-amber-700 (warn level)
const SKY_700 = "#0369a1"; // text-sky-700 (info level, expand hint)

describe("light-scheme level and hint text contrast", () => {
  it("text-amber-700 reaches 4.5:1 on the light paper", () => {
    expect(contrastRatio(AMBER_700, lightPaper())).toBeGreaterThanOrEqual(AA_BODY_TEXT);
  });

  it("text-sky-700 reaches 4.5:1 on the light paper", () => {
    expect(contrastRatio(SKY_700, lightPaper())).toBeGreaterThanOrEqual(AA_BODY_TEXT);
  });
});
