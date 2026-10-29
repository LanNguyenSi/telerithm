import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// vitest runs with the frontend package as its working directory (its config and
// its `test` script both live there), which is how the CSS path is found here.
const globalsCss = readFileSync(resolve(process.cwd(), "src/app/globals.css"), "utf8");

/** A hex colour declared in the `.dark { ... }` block of globals.css. */
function darkToken(name: string): string {
  const block = /\.dark\s*\{([^}]*)\}/.exec(globalsCss)?.[1];
  if (!block) throw new Error("globals.css has no .dark { ... } block to read tokens from");

  const value = new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`).exec(block)?.[1];
  if (!value) throw new Error(`globals.css has no six digit hex dark --${name} token`);
  return value.toLowerCase();
}

/** WCAG relative luminance of a six digit hex colour. */
function relativeLuminance(hex: string): number {
  const rgb = parseInt(hex.slice(1), 16);
  const channels = [(rgb >> 16) & 0xff, (rgb >> 8) & 0xff, rgb & 0xff].map((channel) => {
    const srgb = channel / 255;
    return srgb <= 0.03928 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
  });
  const [red, green, blue] = channels;
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

/** WCAG contrast ratio of two colours: 1 (indistinguishable) to 21 (black on white). */
function contrastRatio(a: string, b: string): number {
  const first = relativeLuminance(a);
  const second = relativeLuminance(b);
  const lighter = Math.max(first, second);
  const darker = Math.min(first, second);
  return (lighter + 0.05) / (darker + 0.05);
}

/** WCAG AA for text below 18 pt / 14 pt bold, what the checks below compare against. */
const AA_BODY_TEXT = 4.5;

/**
 * Dark surfaces the muted text sits on that are no CSS token, so they are pinned
 * here. Both are translucent white over the dark card panel over the page
 * background; the composited colour only exists in a rendered page, which is
 * where they were measured (axe, dark theme, 1280 px):
 *
 * - `#363c47`, the neutral team chip in the admin user table (`bg-white/5` over a
 *   table row), the surface that failed first at 3.53:1.
 * - `#2c323e`, the closed select trigger (`bg-white/10` over a card), which
 *   failed at 4.10:1.
 *
 * With the current token they measure 5.13:1 and 5.95:1, as recorded in the
 * CHANGELOG entry for the token bump.
 */
const ADMIN_TEAM_CHIP = "#363c47";
const SELECT_BACKGROUND = "#2c323e";

/**
 * `--color-muted` in `.dark` before the bump, kept to keep the pin honest: it
 * clears every test above if the threshold is ever lowered towards 3.
 */
const MUTED_BEFORE_THE_BUMP = "#8892a4";

/**
 * Dark theme muted text has to reach AA on the darkest surfaces it is used on,
 * not just on the page background. The page background is a token and read from
 * the CSS; the two blended surfaces are constants above (see their comment for
 * how they were measured), so they are only pinned as far as a rendered colour
 * that no CSS file contains can be.
 */
describe("dark theme muted text contrast (WCAG 1.4.3)", () => {
  const muted = darkToken("color-muted");
  const paper = darkToken("color-paper");

  it("reads the dark muted and paper tokens out of globals.css", () => {
    expect(muted).toMatch(/^#[0-9a-f]{6}$/);
    expect(paper).toMatch(/^#[0-9a-f]{6}$/);
    expect(muted).not.toBe(paper);
  });

  it("keeps muted text at AA on the dark page background", () => {
    expect(contrastRatio(muted, paper)).toBeGreaterThanOrEqual(AA_BODY_TEXT);
  });

  it("keeps muted text at AA on the admin team chip", () => {
    expect(contrastRatio(muted, ADMIN_TEAM_CHIP)).toBeGreaterThanOrEqual(AA_BODY_TEXT);
  });

  it("keeps muted text at AA on the select background", () => {
    expect(contrastRatio(muted, SELECT_BACKGROUND)).toBeGreaterThanOrEqual(AA_BODY_TEXT);
  });

  it("rejects the muted value that this pin was written for", () => {
    // Calibration self-check: compares only constants, so it guards the threshold, not the CSS.
    // 3.53:1 and 4.10:1: AA large text, AA body text no. The boundary that makes
    // the threshold above meaningful, and the reason 4.5 cannot be lowered.
    expect(contrastRatio(MUTED_BEFORE_THE_BUMP, ADMIN_TEAM_CHIP)).toBeLessThan(AA_BODY_TEXT);
    expect(contrastRatio(MUTED_BEFORE_THE_BUMP, SELECT_BACKGROUND)).toBeLessThan(AA_BODY_TEXT);
    expect(contrastRatio(MUTED_BEFORE_THE_BUMP, ADMIN_TEAM_CHIP)).toBeGreaterThanOrEqual(3);
  });
});
