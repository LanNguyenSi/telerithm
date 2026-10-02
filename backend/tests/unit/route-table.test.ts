import { beforeAll, describe, expect, it, vi } from "vitest";
import express, { Router, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import {
  createWriteRoute,
  isWriteRouteHandler,
  teamFromBody,
  type WriteRouteDeps,
} from "../../src/api/rest/write-route.js";
import { ROUTE_WRITE_GUARDS, type Guard } from "./route-guards.js";

// Runtime guard for the "VIEWER is read-only on team-scoped writes" rule.
//
// router-write-role.test.ts reads router.ts as text, so it only sees the
// spellings it knows (callee names, literal paths, the apiRouter receiver). An
// aliased Router(), a const path, a second router mounted in app.ts or an
// inline mutating app.use(...) all register a route without any of those
// spellings. This test closes the class at runtime instead: it builds the real
// app with createApp(), walks the Express layer stack recursively (mounted
// routers included) and requires that
//   1. every layer the app and the API router carry is on a known list, so no
//      router, middleware or route appears that nobody classified;
//   2. no state-changing route exists outside the one API router mounted at
//      /api/v1;
//   3. every state-changing route of the API router is classified in
//      ROUTE_WRITE_GUARDS: "write" routes are served by exactly one handler,
//      the one writeRoute registered (write-route.ts tags it), and allowlisted
//      routes are not served by the wrapper.
// The static scan stays for what the runtime table cannot see: that each
// writeRoute call has the (method, path, resolver, handler) shape with plain
// identifier factory arguments, and that the wrapper is bound to the real
// requireAuth and requireTeamWriteRole. The wrapper's own order (auth, team,
// gate, handler) is proven in write-route.test.ts.

// The same module mocks as tests/integration/api.test.ts, only as thin as
// building the app needs: no request is sent here.
vi.mock("../../src/config/index.js", () => ({
  config: {
    port: 4000,
    host: "127.0.0.1",
    nodeEnv: "test",
    databaseUrl: "postgresql://test:test@localhost:5432/test",
    clickhouseUrl: "http://localhost:8123",
    logLevel: "silent",
    corsOrigins: "*",
    redisUrl: "redis://localhost:6379",
    multiTenant: false,
    registrationMode: "approval",
    adminEmail: "admin@test.com",
    openaiApiKey: undefined,
    maxLookbackMs: 7 * 24 * 60 * 60 * 1000,
    maxPageSize: 500,
    maxSyncRuntimeMs: 1500,
    notificationTestRateLimitWindowMs: 200,
    notificationTestRateLimitMax: 3,
  },
}));
vi.mock("../../src/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), fatal: vi.fn() },
  createChildLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));
vi.mock("../../src/repositories/prisma.js", () => ({
  prisma: {},
  connectDatabase: vi.fn(),
  disconnectDatabase: vi.fn(),
}));
vi.mock("../../src/repositories/clickhouse.js", () => ({
  clickhouse: {},
  connectClickHouse: vi.fn(),
  disconnectClickHouse: vi.fn(),
}));
vi.mock("../../src/repositories/redis.js", () => ({
  redis: {},
  connectRedis: vi.fn(),
  disconnectRedis: vi.fn(),
}));

// --- Reading the Express 4 layer stack --------------------------------------

interface Layer {
  name: string;
  handle: ((...args: unknown[]) => unknown) & { stack?: Layer[] };
  regexp: RegExp & { fast_slash?: boolean };
  route?: { path: unknown; methods: Record<string, boolean>; stack: Layer[] };
}

function stackOf(app: express.Express): Layer[] {
  return (app as unknown as { _router: { stack: Layer[] } })._router.stack;
}

// "/api/v1" for the mount regexp Express 4 builds from app.use("/api/v1", ...).
function mountPathOf(layer: Layer): string {
  if (layer.regexp.fast_slash) return "/";
  const match = /^\^((?:\\\/[\w-]+)+)\\\/\?\(\?=\\\/\|\$\)$/.exec(layer.regexp.source);
  return match ? match[1].replace(/\\\//g, "/") : `<unparsed ${layer.regexp.source}>`;
}

const SAFE_METHODS = new Set(["get", "head", "options"]);

function methodsOf(route: NonNullable<Layer["route"]>): string[] {
  return Object.keys(route.methods).filter((m) => route.methods[m]);
}

function isRouterLayer(layer: Layer): boolean {
  return layer.name === "router" || Array.isArray(layer.handle.stack);
}

function describeLayer(layer: Layer): string {
  if (layer.route) return `route ${methodsOf(layer.route).join(",")} ${String(layer.route.path)}`;
  if (isRouterLayer(layer)) return `router ${mountPathOf(layer)}`;
  return `middleware ${mountPathOf(layer)} ${layer.name} /${layer.handle.length}`;
}

// --- The audit ---------------------------------------------------------------

interface ExpectedLayer {
  // describeLayer() of the layer at this position.
  layer: string;
  // Anonymous layers are told apart by a fragment of their source.
  sourceIncludes?: string;
}

interface AuditConfig {
  // The one router that may carry the API routes, and where it is mounted.
  apiRouter: unknown;
  apiMount: string;
  // Every layer of the app, in order, route layers included.
  appLayers: ExpectedLayer[];
  // Every non-route layer of the API router (router-level middleware).
  routerLayers: ExpectedLayer[];
  guards: Record<string, Guard>;
}

interface RouteEntry {
  method: string;
  path: string;
  handlers: Layer[];
  // Mount chain from the app down to the router that owns the route.
  chain: Array<{ mount: string; handle: unknown }>;
}

function collectRoutes(stack: Layer[], chain: RouteEntry["chain"], out: RouteEntry[]): void {
  for (const layer of stack) {
    if (layer.route) {
      for (const method of methodsOf(layer.route)) {
        out.push({ method, path: String(layer.route.path), handlers: layer.route.stack, chain });
      }
    } else if (isRouterLayer(layer)) {
      collectRoutes(
        layer.handle.stack ?? [],
        [...chain, { mount: mountPathOf(layer), handle: layer.handle }],
        out,
      );
    }
  }
}

function compareLayers(where: string, actual: Layer[], expected: ExpectedLayer[]): string[] {
  const violations: string[] = [];
  const actualDescriptions = actual.map(describeLayer);
  const length = Math.max(actual.length, expected.length);
  for (let i = 0; i < length; i += 1) {
    const got = actualDescriptions[i];
    const want = expected[i]?.layer;
    if (got !== want) {
      violations.push(
        `${where}: layer #${i} is ${got === undefined ? "missing" : `"${got}"`}, expected ${
          want === undefined ? "nothing" : `"${want}"`
        }; a new router, middleware or route must be added to the known list on purpose`,
      );
    } else if (
      expected[i].sourceIncludes &&
      !actual[i].handle.toString().includes(expected[i].sourceIncludes!)
    ) {
      violations.push(
        `${where}: layer #${i} "${got}" is not the expected function (source lacks "${expected[i].sourceIncludes}")`,
      );
    }
  }
  return violations;
}

function auditApp(app: express.Express, config: AuditConfig): string[] {
  const violations: string[] = [];
  const appStack = stackOf(app);
  violations.push(...compareLayers("app", appStack, config.appLayers));

  const entries: RouteEntry[] = [];
  collectRoutes(appStack, [], entries);

  // The API router's own non-route layers (router-level middleware).
  const apiLayer = appStack.find((layer) => isRouterLayer(layer) && layer.handle === config.apiRouter);
  if (!apiLayer) {
    violations.push("the API router is not mounted on the app");
  } else {
    if (mountPathOf(apiLayer) !== config.apiMount) {
      violations.push(`the API router is mounted at ${mountPathOf(apiLayer)}, expected ${config.apiMount}`);
    }
    const nonRoute = (apiLayer.handle.stack ?? []).filter((layer) => !layer.route);
    violations.push(...compareLayers("API router", nonRoute, config.routerLayers));
  }

  const seen = new Set<string>();
  const runtimeKeys = new Set<string>();
  for (const entry of entries) {
    const method = entry.method.toLowerCase();
    if (SAFE_METHODS.has(method)) continue;
    const key = `${method.toUpperCase()} ${entry.path}`;
    const where = entry.chain.map((link) => link.mount).join(" > ") || "app";
    const inApiRouter =
      entry.chain.length === 1 &&
      entry.chain[0].handle === config.apiRouter &&
      entry.chain[0].mount === config.apiMount;
    if (!inApiRouter) {
      violations.push(`state-changing route ${key} outside the API router (mounted at ${where})`);
      continue;
    }
    runtimeKeys.add(key);
    if (seen.has(key)) violations.push(`${key} is registered more than once`);
    seen.add(key);

    const guard = config.guards[key];
    const served = entry.handlers.map((layer) => layer.handle);
    const wrapped = served.some((handle) => isWriteRouteHandler(handle));
    if (!guard) {
      violations.push(`unclassified state-changing route ${key}`);
    } else if (guard.kind === "write") {
      if (!(served.length === 1 && wrapped)) {
        violations.push(
          `${key} is classified "write" but not served by exactly the writeRoute handler ` +
            `(${served.length} handler(s), wrapper tag ${wrapped})`,
        );
      }
    } else {
      if (wrapped) violations.push(`${key} is allowlisted but served by writeRoute; classify it "write"`);
      if (guard.reason.length <= 20) violations.push(`${key} needs a real allowlist justification`);
    }
  }
  for (const key of Object.keys(config.guards)) {
    if (!runtimeKeys.has(key)) violations.push(`stale classification ${key}: no such route at runtime`);
  }
  return violations;
}

// --- The real app ------------------------------------------------------------

const REAL_APP_LAYERS: ExpectedLayer[] = [
  { layer: "middleware / query /3" },
  { layer: "middleware / expressInit /3" },
  { layer: "middleware / helmetMiddleware /3" },
  { layer: "middleware / corsMiddleware /3" },
  { layer: "middleware / jsonParser /3" },
  // express-rate-limit's general limiter: an anonymous async wrapper.
  { layer: "middleware / <anonymous> /3" },
  // The request-id, access-log and metrics middleware.
  { layer: "middleware / <anonymous> /3", sourceIncludes: "X-Request-Id" },
  { layer: "route get /metrics" },
  { layer: "middleware /docs swaggerInitFn /3" },
  { layer: "middleware /docs serveStatic /3" },
  { layer: "middleware /docs <anonymous> /2" },
  { layer: "route get /openapi.json" },
  { layer: "router /api/v1" },
  // The central error handler.
  { layer: "middleware / <anonymous> /4", sourceIncludes: "Unhandled error" },
];

let realApp: express.Express;
let realApiRouter: unknown;

beforeAll(async () => {
  const { createApp } = await import("../../src/app.js");
  ({ apiRouter: realApiRouter } = await import("../../src/api/rest/router.js"));
  realApp = createApp();
});

function realConfig(): AuditConfig {
  return {
    apiRouter: realApiRouter,
    apiMount: "/api/v1",
    appLayers: REAL_APP_LAYERS,
    routerLayers: [],
    guards: ROUTE_WRITE_GUARDS,
  };
}

describe("the runtime route table of createApp()", () => {
  it("every layer is known, every state-changing route is classified, and every write route is served by the wrapper", () => {
    expect(auditApp(realApp, realConfig())).toEqual([]);
  });

  it("sees the real routes (sanity check the walk is not empty)", () => {
    const entries: RouteEntry[] = [];
    collectRoutes(stackOf(realApp), [], entries);
    const writes = entries.filter(
      (e) => e.chain.length === 1 && e.handlers.length === 1 && isWriteRouteHandler(e.handlers[0].handle),
    );
    expect(writes.map((e) => `${e.method.toUpperCase()} ${e.path}`).sort()).toEqual(
      Object.entries(ROUTE_WRITE_GUARDS)
        .filter(([, guard]) => guard.kind === "write")
        .map(([key]) => key)
        .sort(),
    );
    expect(entries.some((e) => e.method === "get" && e.chain.length === 1)).toBe(true);
    expect(entries.some((e) => e.method === "post" && !isWriteRouteHandler(e.handlers[0].handle))).toBe(true);
  });
});

// --- Controls: shapes the static scan cannot see, run through the same audit --

const FAKE_DEPS = {
  requireAuth: async () => "user-1",
  requireTeamWriteRole: async () => "MEMBER" as const,
};
const sourceSchema = z.object({ teamId: z.string() });
const noop = (_req: Request, res: Response): void => {
  res.status(204).end();
};
const passThrough = (_req: Request, _res: Response, next: NextFunction): void => next();

interface Built {
  app: express.Express;
  apiRouter: express.Router;
  writeRoute: ReturnType<typeof createWriteRoute>;
}

// A miniature of app.ts and router.ts: the API router with one wrapper route
// (POST /sources) and one allowlisted route (POST /logs/search), mounted at
// /api/v1. `extend` adds the escape under test.
function build(extend?: (built: Built) => void, mountApi = true): Built {
  const app = express();
  const apiRouter = Router();
  const writeRoute = createWriteRoute({ router: apiRouter, ...FAKE_DEPS } as WriteRouteDeps);
  writeRoute("post", "/sources", teamFromBody(sourceSchema), async ({ res }) => {
    res.status(201).end();
  });
  apiRouter.post("/logs/search", noop);
  apiRouter.get("/sources", noop);
  const built = { app, apiRouter, writeRoute };
  extend?.(built);
  if (mountApi) app.use("/api/v1", apiRouter);
  return built;
}

const CONTROL_GUARDS: Record<string, Guard> = {
  "POST /sources": { kind: "write" },
  "POST /logs/search": { kind: "allowlist", reason: "Reading POST: mutates nothing, membership required." },
};

function controlConfig(built: Built, overrides: Partial<AuditConfig> = {}): AuditConfig {
  return {
    apiRouter: built.apiRouter,
    apiMount: "/api/v1",
    appLayers: [
      { layer: "middleware / query /3" },
      { layer: "middleware / expressInit /3" },
      { layer: "router /api/v1" },
    ],
    routerLayers: [],
    guards: CONTROL_GUARDS,
    ...overrides,
  };
}

describe("controls: each escape a spelling-based scan misses is reported at runtime", () => {
  it("the unmodified miniature is clean (positive control)", () => {
    const built = build();
    expect(auditApp(built.app, controlConfig(built))).toEqual([]);
  });

  it("an aliased Router() mounted at /api/v1 next to the real one", () => {
    const makeRouter = Router;
    const built = build(({ app }) => {
      const second = makeRouter();
      second.post("/widgets", noop);
      app.use("/api/v1", second);
    });
    const violations = auditApp(built.app, controlConfig(built));
    expect(violations.join("\n")).toMatch(/state-changing route POST \/widgets outside the API router/);
    expect(violations.join("\n")).toMatch(/app: layer #3 is "router \/api\/v1", expected nothing/);
  });

  it("a router from another module on a const path, mounted by app.ts", () => {
    const path = "/api/v1/";
    const built = build(({ app }) => {
      const extra = Router();
      extra.delete(path + "widgets", noop);
      app.use("/extra", extra);
    });
    expect(auditApp(built.app, controlConfig(built)).join("\n")).toMatch(
      /state-changing route DELETE \/api\/v1\/widgets outside the API router \(mounted at \/extra\)/,
    );
  });

  it("an inline mutating app.use(...) middleware", () => {
    const built = build(({ app }) => {
      app.use((_req: Request, _res: Response, next: NextFunction) => next());
    });
    expect(auditApp(built.app, controlConfig(built)).join("\n")).toMatch(
      /app: layer #2 is "middleware \/ <anonymous> \/3"/,
    );
  });

  it("a state-changing route registered directly on the app", () => {
    const built = build(({ app }) => {
      app.post("/widgets", noop);
    });
    expect(auditApp(built.app, controlConfig(built)).join("\n")).toMatch(
      /state-changing route POST \/widgets outside the API router \(mounted at app\)/,
    );
  });

  it("app.all on the app counts as state-changing", () => {
    const built = build(({ app }) => {
      app.all("/widgets", noop);
    });
    expect(auditApp(built.app, controlConfig(built)).join("\n")).toMatch(
      /state-changing route POST \/widgets outside the API router \(mounted at app\)/,
    );
  });

  it("a new mutating route on the API router without a classification", () => {
    const built = build(({ apiRouter }) => {
      apiRouter.put("/widgets/:id", noop);
    });
    expect(auditApp(built.app, controlConfig(built))).toEqual([
      "unclassified state-changing route PUT /widgets/:id",
    ]);
  });

  it("a route chained with apiRouter.route(...)", () => {
    const built = build(({ apiRouter }) => {
      apiRouter.route("/widgets").patch(noop);
    });
    expect(auditApp(built.app, controlConfig(built))).toEqual([
      "unclassified state-changing route PATCH /widgets",
    ]);
  });

  it('a "write" route moved back to a plain handler (no wrapper tag)', () => {
    const built = build(({ apiRouter }) => {
      apiRouter.post("/other", noop);
    });
    expect(
      auditApp(built.app, {
        ...controlConfig(built),
        guards: { ...CONTROL_GUARDS, "POST /other": { kind: "write" } },
      }),
    ).toEqual([
      'POST /other is classified "write" but not served by exactly the writeRoute handler (1 handler(s), wrapper tag false)',
    ]);
  });

  it('a "write" route with a middleware in front of the wrapper handler', () => {
    const built = build(({ apiRouter }) => {
      const withMiddleware = createWriteRoute({
        router: {
          post: (path: string, handler: never) => apiRouter.post(path, passThrough, handler),
          put: apiRouter.put.bind(apiRouter),
          patch: apiRouter.patch.bind(apiRouter),
          delete: apiRouter.delete.bind(apiRouter),
        } as unknown as WriteRouteDeps["router"],
        ...FAKE_DEPS,
      } as WriteRouteDeps);
      withMiddleware("post", "/guarded", teamFromBody(sourceSchema), async () => {});
    });
    expect(
      auditApp(built.app, {
        ...controlConfig(built),
        guards: { ...CONTROL_GUARDS, "POST /guarded": { kind: "write" } },
      }),
    ).toEqual([
      'POST /guarded is classified "write" but not served by exactly the writeRoute handler (2 handler(s), wrapper tag true)',
    ]);
  });

  it("a wrapper route that is still on the allowlist", () => {
    const built = build();
    expect(
      auditApp(built.app, {
        ...controlConfig(built),
        guards: { ...CONTROL_GUARDS, "POST /sources": CONTROL_GUARDS["POST /logs/search"] },
      }),
    ).toEqual(['POST /sources is allowlisted but served by writeRoute; classify it "write"']);
  });

  it("router-level middleware on the API router", () => {
    const built = build(({ apiRouter }) => {
      apiRouter.use(passThrough);
    });
    expect(auditApp(built.app, controlConfig(built)).join("\n")).toMatch(
      /API router: layer #0 is "middleware \/ passThrough \/3"/,
    );
  });

  it("a router nested inside the API router", () => {
    const built = build(({ apiRouter }) => {
      const nested = Router();
      nested.post("/widgets", noop);
      apiRouter.use("/nested", nested);
    });
    const text = auditApp(built.app, controlConfig(built)).join("\n");
    expect(text).toMatch(/API router: layer #0 is "router \/nested"/);
    expect(text).toMatch(
      /state-changing route POST \/widgets outside the API router \(mounted at \/api\/v1 > \/nested\)/,
    );
  });

  it("the same route registered twice", () => {
    const built = build(({ apiRouter }) => {
      apiRouter.post("/logs/search", noop);
    });
    expect(auditApp(built.app, controlConfig(built))).toEqual([
      "POST /logs/search is registered more than once",
    ]);
  });

  it("a classification whose route is gone", () => {
    const built = build();
    expect(
      auditApp(built.app, {
        ...controlConfig(built),
        guards: { ...CONTROL_GUARDS, "DELETE /gone": { kind: "write" } },
      }),
    ).toEqual(["stale classification DELETE /gone: no such route at runtime"]);
  });

  it("a second router in place of the real one under /api/v1", () => {
    const built = build(undefined, false);
    const impostor = Router();
    impostor.post("/sources", noop);
    built.app.use("/api/v1", impostor);
    expect(auditApp(built.app, controlConfig(built)).join("\n")).toMatch(
      /the API router is not mounted on the app/,
    );
  });

  it("an allowlist entry without a real justification", () => {
    const built = build();
    expect(
      auditApp(built.app, {
        ...controlConfig(built),
        guards: { ...CONTROL_GUARDS, "POST /logs/search": { kind: "allowlist", reason: "ok" } },
      }),
    ).toEqual(["POST /logs/search needs a real allowlist justification"]);
  });
});
