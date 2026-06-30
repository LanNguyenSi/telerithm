import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      include: ["src/**/*.ts"],
      exclude: ["src/__tests__/**", "src/**/*.test.ts"],
      thresholds: {
        lines: 94,
        statements: 92,
        functions: 92,
        branches: 85,
      },
    },
  },
});
