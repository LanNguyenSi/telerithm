# @telerithm/sdk reference

Full configuration options and API surface for `@telerithm/sdk`, moved out of the package README to keep it short.

## Configuration options

Pass these to `init(options)` or the `TelerithmClient` constructor.

| Option            | Default | Description                                                                          |
| ----------------- | ------- | ------------------------------------------------------------------------------------ |
| `dsn`             | none    | DSN string (`https://<key>@<host>/<sourceId>`)                                       |
| `endpoint`        | none    | Backend base URL (alternative to `dsn`); the SDK appends `/api/v1/ingest/<sourceId>` |
| `apiKey`          | none    | API key (alternative to `dsn`)                                                       |
| `sourceId`        | none    | Source ID appended to `endpoint` (alternative to `dsn`)                              |
| `service`         | `"unknown"` | Service name attached to every event                                             |
| `release`         | none    | Release / version tag                                                                |
| `environment`     | none    | `production` / `staging` / etc.                                                      |
| `autoCapture`     | `true`  | Install `uncaughtException` / `unhandledRejection` handlers                          |
| `breadcrumbs`     | `true`  | Capture breadcrumbs (console warn/error + manual)                                    |
| `maxBreadcrumbs`  | `20`    | Cap on retained breadcrumbs per event                                                |
| `batchSize`       | `10`    | Flush after this many queued logs                                                    |
| `flushIntervalMs` | `5000`  | Periodic flush interval                                                              |
| `timeout`         | `10000` | HTTP timeout per flush                                                               |

`endpoint` is the backend base URL (no path, no trailing slash); the SDK appends `/api/v1/ingest/<sourceId>` itself. Do not include that path in `endpoint` or requests will double it, and a trailing slash on `endpoint` will double the slash in the built URL.

## API reference

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

`TelerithmClient` also exposes `debug`, `info`, `warn`, `error` shorthands for `log(level, ...)`, and `addBreadcrumb(crumb)` for manual breadcrumb entries.
