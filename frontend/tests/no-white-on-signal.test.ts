import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

// vitest runs with the frontend package as its working directory.
const SRC = resolve(process.cwd(), "src");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

/** Quoted and template strings of a source file, the places a className lives. */
function stringLiterals(source: string): string[] {
  return source.match(/"[^"\n]*"|`[^`]*`|'[^'\n]*'/g) ?? [];
}

function hasWhiteOnSignal(literal: string): boolean {
  const classes = literal.split(/[\s"'`]+/);
  const signalFill = classes.some((c) => c === "bg-signal");
  return signalFill && classes.some((c) => c === "text-white");
}

describe("white text on the signal colour", () => {
  it("is detected in a className that mixes bg-signal and text-white", () => {
    expect(hasWhiteOnSignal('"rounded bg-signal px-3 text-white"')).toBe(true);
    expect(hasWhiteOnSignal('"rounded bg-signal/10 text-signal"')).toBe(false);
  });

  it("is not used by any className under frontend/src (3.68:1 light, 1.81:1 dark)", () => {
    const offenders = sourceFiles(SRC).flatMap((file) =>
      stringLiterals(readFileSync(file, "utf8"))
        .filter(hasWhiteOnSignal)
        .map((literal) => `${file}: ${literal}`),
    );
    expect(offenders).toEqual([]);
  });
});
