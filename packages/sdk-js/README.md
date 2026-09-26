# @telerithm/sdk

Client SDK for [Telerithm](https://github.com/LanNguyenSi/telerithm): ship structured logs, errors, and breadcrumbs from JavaScript / TypeScript apps to a Telerithm backend.

## Overview

`@telerithm/sdk` batches logs in memory and flushes them to a Telerithm ingest endpoint over `fetch`, so it runs in Node, modern browsers, and edge runtimes without extra dependencies. Configure it once with a DSN or with direct fields, then call `log`, `captureError`, `setUser`, and `setTag` from anywhere in the app. Pre-1.0: the API and on-the-wire payload may change between minor versions.

## Key features

- Batched log delivery with configurable `batchSize` and `flushIntervalMs`
- Structured logging at `debug` / `info` / `warn` / `error` / `fatal` levels
- Error capture with stack trace and message extraction
- Breadcrumb tracking (console warn/error, plus manual `addBreadcrumb`)
- Global `uncaughtException` / `unhandledRejection` capture, opt-out via `autoCapture: false`
- User and tag context attached to every subsequent event
- DSN or direct `endpoint` + `apiKey` configuration
- ESM + CJS dual exports with TypeScript type declarations

## Install

```bash
npm install @telerithm/sdk
```

Node.js >= 18. Works in Node, modern browsers, and edge runtimes that support `fetch`.

## Usage

```ts
import { init, log, captureError, setUser } from "@telerithm/sdk";

init({
  dsn: "https://<api-key>@logs.example.com/<source-id>",
  service: "my-app",
  release: "1.4.2",
  environment: "production",
});

log("info", "user signed in", { userId: "u_123" });

setUser({ id: "u_123", email: "lan@example.com" });

try {
  // ...
} catch (err) {
  captureError(err as Error, { route: "/checkout" });
}
```

The default client batches logs in memory and flushes them at `flushIntervalMs` or when `batchSize` is reached. There is no automatic flush on shutdown: call `await client.close()` before your process exits (or on `beforeunload` in the browser), otherwise logs still in the buffer are lost.

You can also configure via direct fields instead of a DSN:

```ts
init({
  endpoint: "https://logs.example.com",
  apiKey: "<key>",
  sourceId: "<sourceId>",
});
```

## Documentation

- [Configuration options and API reference](docs/reference.md): every `init` option and the full exported function list.
- [CHANGELOG.md](./CHANGELOG.md): per-release notes.

## Development

```bash
npm install
npm test              # vitest
npm run build         # tsup, emits dist/ (esm, cjs, .d.ts)
```

See the repo root's [CONTRIBUTING.md](../../CONTRIBUTING.md) for the full workflow.

## License

MIT, see [LICENSE](./LICENSE). Pre-1.0, breaking changes may land in minor releases; see [CHANGELOG.md](./CHANGELOG.md).
