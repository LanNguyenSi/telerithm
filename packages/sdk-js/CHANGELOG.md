# Changelog

All notable changes to `@telerithm/sdk` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/),
and this project adheres to [Semantic Versioning](https://semver.org/).
SDK releases are tagged on the parent repo as `sdk-vX.Y.Z`.

## [0.1.0] - 2026-04-26

First public release of the SDK. Pre-1.0: the API and on-the-wire
payload may change between minor versions until v1.0.0.

### Added

- `init(options)` / `getClient()` — global client lifecycle.
- `log(level, message, extra?)` — structured log emission with levels
  `debug` / `info` / `warn` / `error` / `fatal`.
- `captureError(error, extra?)` — error capture with stack trace and
  message extraction.
- `setUser(user)` / `setTag(key, value)` — context that attaches to
  every subsequent event.
- `flush()` / `close()` — explicit flush + clean teardown for
  short-lived processes.
- DSN parsing: `https://<apiKey>@<host>/<sourceId>` resolves to
  `endpoint` + `apiKey`. Direct `endpoint` + `apiKey` config also
  supported.
- Breadcrumb tracking integration (console + manual `addBreadcrumb`),
  capped at `maxBreadcrumbs` (default 100) and attached to error
  events.
- Global error-handler integration (`uncaughtException`,
  `unhandledRejection`, `window.onerror`, `unhandledrejection`) wired
  up automatically when `autoCapture: true` (default).
- Fetch-based transport with batched POSTs, configurable
  `batchSize`, `flushIntervalMs`, and `timeout`.
- ESM + CJS dual exports + TypeScript type declarations
  (`dist/index.{js,cjs,d.ts,d.cts}`).

### Distribution

- npm package: `@telerithm/sdk` (this release is the first publish).
  Install with `npm install @telerithm/sdk`.
- Tarball is `dist/` only — `~3.9 KB` gzipped.
- Published with `--provenance` (npm transparency-log attestation
  via GitHub Actions OIDC).
