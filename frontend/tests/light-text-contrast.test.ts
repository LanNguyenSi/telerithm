import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const globalsCss = readFileSync(resolve(process.cwd(), "src/app/globals.css"), "utf8");
const liveTailSrc = readFileSync(resolve(process.cwd(), "src/components/logs/live-tail.tsx"), "utf8");
const sidebarSrc = readFileSync(resolve(process.cwd(), "src/components/dashboard/sidebar.tsx"), "utf8");

/** The light page background: `--color-paper` in the `:root { ... }` block. */
function lightPaper(): string {
  const block = rootBlock();
  const value = /--color-paper:\s*(#[0-9a-fA-F]{6})/.exec(block)?.[1];
  if (!value) throw new Error("globals.css has no six digit hex :root --color-paper");
  return value.toLowerCase();
}

function rootBlock(): string {
  const block = /:root\s*\{([^}]*)\}/.exec(globalsCss)?.[1];
  if (!block) throw new Error("globals.css has no :root { ... } block");
  return block;
}

/**
 * The Card paints `--color-panel` at 85% over the paper, so the panel the
 * light-scheme text sits on is that composite, not the bare paper.
 */
function lightPanel(): string {
  const panel = /--color-panel:\s*#([0-9a-fA-F]{6})([0-9a-fA-F]{2})/.exec(rootBlock());
  if (!panel) throw new Error("globals.css has no eight digit hex :root --color-panel");
  const panelRgb = parseInt(panel[1], 16);
  const alpha = (parseInt(panel[2], 16) / 255) * 0.85;
  const paperRgb = parseInt(lightPaper().slice(1), 16);
  const channels = [16, 8, 0].map((shift) => {
    const over = (panelRgb >> shift) & 0xff;
    const under = (paperRgb >> shift) & 0xff;
    return Math.round(alpha * over + (1 - alpha) * under);
  });
  return "#" + channels.map((c) => c.toString(16).padStart(2, "0")).join("");
}

function blendOver(foreground: string, alpha: number, background: string): string {
  const fg = parseInt(foreground.slice(1), 16);
  const bg = parseInt(background.slice(1), 16);
  const channels = [16, 8, 0].map((shift) => {
    const over = (fg >> shift) & 0xff;
    const under = (bg >> shift) & 0xff;
    return Math.round(alpha * over + (1 - alpha) * under);
  });
  return "#" + channels.map((c) => c.toString(16).padStart(2, "0")).join("");
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

// Tailwind v4 palette value behind text-emerald-700 (oklch(50.8% 0.118 165.612));
// emerald-600 was 3.6:1 on the light panel and failed axe color-contrast.
const EMERALD_700 = "#007a55"; // text-emerald-700 (live tail Connected, light scheme)

describe("live tail Connected status contrast", () => {
  it("the Connected span uses text-emerald-700 in the light scheme", () => {
    expect(liveTailSrc).toContain('connected ? "text-sm text-emerald-700 dark:text-emerald-400"');
    expect(liveTailSrc).not.toContain("text-emerald-600");
  });

  it("text-emerald-700 reaches 4.5:1 on the light panel", () => {
    expect(contrastRatio(EMERALD_700, lightPanel())).toBeGreaterThanOrEqual(AA_BODY_TEXT);
  });
});

// The sidebar surfaces are always #0f1419, but the chip must not follow
// --color-signal (#0891b2 in light gave 3.9:1 on the chip); a fixed cyan
// keeps the same numbers in both schemes.
const AVATAR_CYAN = "#22d3ee"; // text-[#22d3ee] (avatar initial)
const SIDEBAR_BG = "#0f1419";

describe("sidebar avatar chip contrast", () => {
  const chipClasses =
    /className="(flex h-7[^"]*rounded-full[^"]*)"/.exec(sidebarSrc)?.[1] ?? "";

  it("the chip uses a fixed cyan independent of the color scheme", () => {
    expect(chipClasses).toContain("bg-[#22d3ee]/20");
    expect(chipClasses).toContain("text-[#22d3ee]");
    expect(chipClasses).not.toContain("bg-signal");
    expect(chipClasses).not.toContain("text-signal");
  });

  it("the avatar initial reaches 4.5:1 on the chip over the sidebar surface", () => {
    const chip = blendOver(AVATAR_CYAN, 0.2, SIDEBAR_BG);
    expect(contrastRatio(AVATAR_CYAN, chip)).toBeGreaterThanOrEqual(AA_BODY_TEXT);
  });
});
