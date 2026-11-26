import { describe, expect, it } from "vitest";
// @ts-expect-error plain ESM config file without type declarations
import nextConfig from "../next.config.mjs";

type Rule = { source: string; headers: { key: string; value: string }[] };

async function rules(): Promise<Rule[]> {
  return (await nextConfig.headers()) as Rule[];
}

describe("next.config headers", () => {
  it("applies one rule to every path", async () => {
    const r = await rules();
    expect(r).toHaveLength(1);
    expect(r[0].source).toBe("/:path*");
  });

  it("sets exactly the four hardening headers", async () => {
    const [rule] = await rules();
    expect(rule.headers).toEqual([
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      { key: "X-Frame-Options", value: "DENY" },
      { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
    ]);
  });

  it("keeps the CSP to frame-ancestors so the inline theme script still runs", async () => {
    const [rule] = await rules();
    const csp = rule.headers.find((h) => h.key === "Content-Security-Policy")!.value;
    expect(csp).not.toMatch(/script-src|default-src/);
    expect(csp.split(";").map((s) => s.trim())).toEqual(["frame-ancestors 'none'"]);
  });
});
