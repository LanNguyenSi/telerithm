# @telerithm/sdk

Client SDK for [Telerithm](https://github.com/LanNguyenSi/telerithm) — ship structured logs, errors, and breadcrumbs from JavaScript / TypeScript apps to a Telerithm backend.

## Install

```bash
npm install @telerithm/sdk
```

Node.js ≥ 18. Works in Node, modern browsers, and edge runtimes that support `fetch`.

## Quick start

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

The default client batches logs in memory and flushes them to the configured ingest endpoint at `flushIntervalMs` or when `batchSize` is reached. `process.exit` and `beforeunload` are handled for you when `autoCapture` is enabled (default).

## Configuration

You can configure either via a DSN or via direct fields:

```ts
init({ dsn: "https://<key>@logs.example.com/<sourceId>" });

// or

init({
  endpoint: "https://logs.example.com/api/v1/ingest/<sourceId>",
  apiKey: "<key>",
});
```

### Options

| Option            | Default | Description                                                  |
| ----------------- | ------- | ------------------------------------------------------------ |
| `dsn`             | —       | DSN string (`https://<key>@<host>/<sourceId>`)               |
| `endpoint`        | —       | Direct ingest URL (alternative to `dsn`)                     |
| `apiKey`          | —       | API key (alternative to `dsn`)                               |
| `service`         | —       | Service name attached to every event                         |
| `release`         | —       | Release / version tag                                        |
| `environment`     | —       | `production` / `staging` / etc.                              |
| `autoCapture`     | `true`  | Install `uncaughtException` / `unhandledRejection` handlers  |
| `breadcrumbs`     | `true`  | Capture breadcrumbs (console + fetch + manual)               |
| `maxBreadcrumbs`  | `100`   | Cap on retained breadcrumbs per event                        |
| `batchSize`       | `50`    | Flush after this many queued logs                            |
| `flushIntervalMs` | `5000`  | Periodic flush interval                                      |
| `timeout`         | `5000`  | HTTP timeout per flush                                       |

## API

```ts
init(options): TelerithmClient    // create + register the global client
getClient(): TelerithmClient | null

log(level, message, extra?)
captureError(error, extra?)

setUser(user)
setTag(key, value)

flush(): Promise<void>             // force a flush
close(): Promise<void>             // flush + tear down (call on shutdown)
```

For multi-client setups (e.g. tests, multiple sinks), import `TelerithmClient` directly and skip `init`:

```ts
import { TelerithmClient } from "@telerithm/sdk";

const client = new TelerithmClient({ ... });
client.log("info", "...");
await client.close();
```

## Versioning

Pre-1.0: the API and on-the-wire payload may change between minor versions. From 1.0 onwards the SDK adheres to [SemVer](https://semver.org/).

See [CHANGELOG.md](./CHANGELOG.md) for per-release notes.

## License

MIT — see [LICENSE](./LICENSE).
