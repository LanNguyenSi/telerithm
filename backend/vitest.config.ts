import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    exclude: ["dist", "node_modules"],
    coverage: {
      exclude: [
        // Config / build tooling files
        "eslint.config.js",
        "vitest.config.ts",
        "prisma/seed.ts",
        // Infrastructure / bootstrapping files that cannot be unit-tested
        "src/server.ts",
        "src/seed.ts",
        "src/logger.ts",
        "src/config/index.ts",
        // Pure type declarations (no executable code)
        "src/types/domain.ts",
        // Database client wrappers (require live DB connections)
        "src/repositories/clickhouse.ts",
        "src/repositories/prisma.ts",
        "src/repositories/redis.ts",
        "src/repositories/in-memory-store.ts",
        // Cache service (wraps Redis — integration-only)
        "src/cache/cache-service.ts",
        // Notification channels (external service integrations) — url-guard.ts is intentionally
        // NOT excluded here so its SSRF-guard logic counts toward coverage thresholds.
        // channels/email.ts, channels/msteams.ts, channels/webhook.ts,
        // notification-dispatcher.ts are now covered by unit tests; see #92 + PR residuals.
        // Streaming service (requires live WS connections)
        "src/services/streaming/streaming-service.ts",
        // Subscription service (event-bus wrappers)
        "src/services/subscription/subscription-service.ts",
        // Alert/team/issue/log-view services (require live DB/Prisma connections)
        // alert-service.ts, alert-evaluation-worker.ts, and team-service.ts are now covered by unit tests.
        "src/services/issue/issue-service.ts",
        "src/services/log-view/log-view-service.ts",
        // Ingestion service and fingerprinting are now covered by unit tests (mocked ClickHouse deps).
        // Dashboard service (requires live DB)
        "src/services/dashboard/dashboard-service.ts",
        // REST router (integration-tested, not unit-tested)
        "src/api/rest/router.ts",
        "src/app.ts",
        // Time utility (trivial, no branching logic)
        "src/utils/time.ts",
        // Test files themselves
        "tests/**",
      ],
    },
  },
});
