import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const globalsCss = readFileSync(resolve(process.cwd(), "src/app/globals.css"), "utf8");
const css = globalsCss.replace(/\/\*[\s\S]*?\*\//g, "");

/** End index (exclusive) of the last top-level `@layer ... { ... }` block, or -1. */
function lastLayerEnd(): number {
  const start = css.lastIndexOf("@layer");
  if (start === -1) return -1;
  const open = css.indexOf("{", start);
  expect(open, "the last @layer block must have an opening brace").toBeGreaterThan(-1);
  let depth = 0;
  for (let i = open; i < css.length; i += 1) {
    if (css[i] === "{") depth += 1;
    else if (css[i] === "}") {
      depth -= 1;
      if (depth === 0) return i + 1;
    }
  }
  throw new Error("the last @layer block is never closed");
}

function focusVisibleRule(): RegExpMatchArray | null {
  return /:focus-visible\s*\{([^}]*)\}/.exec(css);
}

function customProp(block: RegExpMatchArray | null, name: string): string {
  if (!block) throw new Error(`globals.css has no ${name} block`);
  const value = new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`).exec(block[1])?.[1];
  if (!value) throw new Error(`globals.css has no six digit hex --${name} in ${name}`);
  return value.toLowerCase();
}

function lightScheme(): RegExpMatchArray | null {
  return /:root\s*\{([^}]*)\}/.exec(css);
}

function darkScheme(): RegExpMatchArray | null {
  return /\.dark\s*\{([^}]*)\}/.exec(css);
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

const WHITE = "#ffffff";
const WCAG_22_FOCUS_APPEARANCE = 3;

describe("focus-visible outline rule in globals.css", () => {
  it("declares a :focus-visible rule", () => {
    expect(focusVisibleRule(), "globals.css must declare a :focus-visible rule").not.toBeNull();
  });

  it("declares it unlayered, after the last @layer block", () => {
    const rule = focusVisibleRule();
    expect(rule, "globals.css must declare a :focus-visible rule").not.toBeNull();
    expect(rule!.index!, "rule must start after the last @layer block").toBeGreaterThan(
      lastLayerEnd(),
    );
  });

  it("sets a solid outline of at least 2 px in var(--color-ink)", () => {
    const rule = focusVisibleRule();
    expect(rule, "globals.css must declare a :focus-visible rule").not.toBeNull();
    const outline = /outline:\s*([\d.]+)px\s+(\w+)\s+var\(--([a-z-]+)\)/.exec(rule![1]);
    expect(outline, "the rule must set a two value color outline shorthand").not.toBeNull();
    expect(Number(outline![1]), "outline width").toBeGreaterThanOrEqual(2);
    expect(outline![2], "outline style").toBe("solid");
    expect(outline![3], "outline color custom property").toBe("color-ink");
  });

  it("light --color-ink reaches 3:1 against light --color-paper", () => {
    expect(contrastRatio(customProp(lightScheme(), "color-ink"), customProp(lightScheme(), "color-paper"))).toBeGreaterThanOrEqual(
      WCAG_22_FOCUS_APPEARANCE,
    );
  });

  it("dark --color-ink reaches 3:1 against dark --color-paper", () => {
    expect(contrastRatio(customProp(darkScheme(), "color-ink"), customProp(darkScheme(), "color-paper"))).toBeGreaterThanOrEqual(
      WCAG_22_FOCUS_APPEARANCE,
    );
  });

  it("light --color-ink reaches 3:1 against white", () => {
    expect(contrastRatio(customProp(lightScheme(), "color-ink"), WHITE)).toBeGreaterThanOrEqual(
      WCAG_22_FOCUS_APPEARANCE,
    );
  });
});
