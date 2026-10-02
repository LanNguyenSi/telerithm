import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import ts from "typescript";
import {
  STATE_CHANGING_METHODS,
  extractRoutes,
  findCallByCallee,
  findUnrecognizedApiRouterUsages,
  loadRouterSourceFile,
  parseSource,
  resolveToCall,
  routeKey,
  routeSatisfiesVerify,
  type RouteDecl,
} from "./router-ast.js";
import { ROUTE_WRITE_GUARDS, type Guard } from "./route-guards.js";

// Structural guard for the "VIEWER is read-only on team-scoped writes" rule
// (see `canWrite` / `requireTeamWriteRole` in router.ts, `writeRoute` in
// write-route.ts, and ENGINEERING.md).
//
// The rule has exactly one home, `canWrite(role)` in router.ts, and one way to
// reach it from a route: `writeRoute(method, path, resolveTeam, handler)`. The
// wrapper authenticates, resolves the team, applies `requireTeamWriteRole` and
// only then calls the handler, so the gate cannot be skipped, reordered or
// hung with side effects by a route author (write-route.test.ts proves that
// behaviourally). This test makes the wrapper mandatory instead of
// enumerating gate placements: it parses router.ts with the TypeScript
// compiler API (it never imports it, which would construct live
// Prisma/ClickHouse/Redis-backed services) and requires that
//   1. every state-changing apiRouter route is either registered through
//      writeRoute (ROUTE_WRITE_GUARDS kind "write") or a justified allowlist
//      entry registered with apiRouter.<method> (kind "allowlist");
//   2. every writeRoute call has exactly the shape (method, path, resolver,
//      handler) with a resolver built by teamFromBody/teamFromResource, so
//      nothing, in particular no middleware, can sit between the router and
//      the gate;
//   3. writeRoute is bound to apiRouter with the real auth and write-gate
//      functions, and no other file registers routes on another router
//      instance or on apiRouter (S4).
// A new mutating route with neither the wrapper nor an allowlist entry fails
// CI, whatever shape its handler has.
//
// This file reads source text, so it only sees the spellings it knows. The
// authoritative S4 answer is route-table.test.ts, which walks the Express
// stack of the real app and so sees every registration however it is spelled
// (aliased Router, const path, a second router mounted in app.ts, an inline
// mutating app.use). What stays here is what that runtime table cannot see:
// the writeRoute call shapes and their factory arguments, the binding, the
// handler-after-gate position inside write-route.ts, and the scan of src for
// code outside createApp() (a route added to the app in server.ts, a second
// express app in the same process).
const SRC_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../src");

// Resolver factories a writeRoute call may use (write-route.ts).
const RESOLVER_FACTORIES = new Set(["teamFromBody", "teamFromResource"]);
// Names router.ts must only use as the write-route.ts imports (and the one
// top-level `const writeRoute` binding), never declare or alias locally.
const WRAPPER_NAMES = new Set(["teamFromBody", "teamFromResource", "writeRoute", "createWriteRoute"]);
const WRITE_ROUTE_MODULE = "./write-route.js";
const SCHEMA_MODULE = "../../validation/schemas.js";
const WRITE_ROUTE_METHODS = new Set(["post", "put", "patch", "delete"]);

// --- Classification ------------------------------------------------------

interface Classification {
  unclassified: string[];
  stale: string[];
  // A "write" entry registered with apiRouter, or an allowlist entry
  // registered with writeRoute.
  wrongRegistration: string[];
}

function classify(routes: RouteDecl[], guards: Record<string, Guard>): Classification {
  const stateChanging = routes.filter((r) => STATE_CHANGING_METHODS.has(r.method));
  const actual = new Map(stateChanging.map((r) => [routeKey(r), r]));
  const unclassified = [...actual.keys()].filter((key) => !(key in guards));
  const stale = Object.keys(guards).filter((key) => !actual.has(key));
  const wrongRegistration: string[] = [];
  for (const [key, route] of actual) {
    const guard = guards[key];
    if (!guard) continue;
    if (guard.kind === "write" && route.via !== "writeRoute") {
      wrongRegistration.push(`${key}: classified "write" but registered with apiRouter.${route.method}`);
    }
    if (guard.kind === "allowlist" && route.via === "writeRoute") {
      wrongRegistration.push(`${key}: allowlisted but registered with writeRoute; classify it "write"`);
    }
  }
  return { unclassified, stale, wrongRegistration };
}

// --- Registration shape --------------------------------------------------

type Issue = { snippet: string; reason: string };

function firstLine(node: ts.Node, sourceFile: ts.SourceFile): string {
  return node.getText(sourceFile).split("\n")[0].trim();
}

type TopLevelDeclaration = ts.ImportSpecifier | ts.VariableDeclaration;

// The top-level import specifiers and variable declarations that bind `name`.
function topLevelDeclarations(sourceFile: ts.SourceFile, name: string): TopLevelDeclaration[] {
  const found: TopLevelDeclaration[] = [];
  for (const statement of sourceFile.statements) {
    if (ts.isImportDeclaration(statement)) {
      const bindings = statement.importClause?.namedBindings;
      if (bindings && ts.isNamedImports(bindings)) {
        for (const element of bindings.elements) if (element.name.text === name) found.push(element);
      }
    } else if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name) && declaration.name.text === name) found.push(declaration);
      }
    }
  }
  return found;
}

function importSource(specifier: ts.ImportSpecifier): string {
  const declaration = specifier.parent.parent.parent;
  return ts.isStringLiteral(declaration.moduleSpecifier) ? declaration.moduleSpecifier.text : "";
}

// A body schema: a plain identifier imported, without renaming, from
// validation/schemas. The schema (with every transform, refinement and
// preprocess step it carries) runs before the write gate, so it may not be an
// inline expression written next to the route.
function isImportedSchema(arg: ts.Expression, sourceFile: ts.SourceFile): boolean {
  if (!ts.isIdentifier(arg)) return false;
  const declarations = topLevelDeclarations(sourceFile, arg.text);
  return (
    declarations.length === 1 &&
    ts.isImportSpecifier(declarations[0]) &&
    declarations[0].propertyName === undefined &&
    importSource(declarations[0]) === SCHEMA_MODULE
  );
}

// A loader: a plain identifier naming a top-level const arrow or function
// expression in router.ts. The loader runs before the write gate and must only
// read; its body is the one place that rule is left to code review.
function isTopLevelLoader(arg: ts.Expression, sourceFile: ts.SourceFile): boolean {
  if (!ts.isIdentifier(arg)) return false;
  const declarations = topLevelDeclarations(sourceFile, arg.text);
  if (declarations.length !== 1) return false;
  const [declaration] = declarations;
  return (
    ts.isVariableDeclaration(declaration) &&
    (declaration.parent.flags & ts.NodeFlags.Const) !== 0 &&
    declaration.initializer !== undefined &&
    (ts.isArrowFunction(declaration.initializer) || ts.isFunctionExpression(declaration.initializer))
  );
}

// The arguments of a resolver factory call are the code a route supplies that
// runs BEFORE the write gate (the loader and the body schema), so they are
// restricted to forms whose code does not sit inline in the route:
//   teamFromBody(<imported schema>)
//   teamFromResource(<top-level loader const>, "<message literal>"[, <imported schema>])
function factoryArgumentProblem(factory: ts.CallExpression, sourceFile: ts.SourceFile): string | null {
  const name = (factory.expression as ts.Identifier).text;
  const args = factory.arguments;
  if (name === "teamFromBody") {
    if (args.length !== 1 || !isImportedSchema(args[0], sourceFile)) {
      return `teamFromBody takes exactly one body schema, a plain identifier imported from ${SCHEMA_MODULE}.`;
    }
    return null;
  }
  if (args.length < 2 || args.length > 3) {
    return "teamFromResource takes (loader, message) or (loader, message, body schema).";
  }
  if (!isTopLevelLoader(args[0], sourceFile)) {
    return "teamFromResource's loader must be a plain identifier naming a top-level const arrow function.";
  }
  if (!ts.isStringLiteral(args[1])) {
    return "teamFromResource's not-found message must be a string literal.";
  }
  if (args[2] !== undefined && !isImportedSchema(args[2], sourceFile)) {
    return `teamFromResource's body schema must be a plain identifier imported from ${SCHEMA_MODULE}.`;
  }
  return null;
}

// router.ts may use teamFromBody, teamFromResource, writeRoute and
// createWriteRoute only as the write-route.ts imports and as the one top-level
// `const writeRoute` binding. A local declaration of the same name (a nested
// `const teamFromBody = ...`, a parameter, a renamed import) would let a
// look-alike pass the shape checks while running arbitrary code before the
// gate. A call and the checked bindings are the only recognised positions.
function findWrapperNameShadowing(sourceFile: ts.SourceFile): Issue[] {
  const issues: Issue[] = [];
  function visit(node: ts.Node): void {
    if (ts.isIdentifier(node) && WRAPPER_NAMES.has(node.text)) {
      const parent = node.parent;
      const isCallee = ts.isCallExpression(parent) && parent.expression === node;
      const isWrapperImport =
        ts.isImportSpecifier(parent) &&
        parent.name === node &&
        parent.propertyName === undefined &&
        importSource(parent) === WRITE_ROUTE_MODULE;
      const isWriterBinding =
        node.text === "writeRoute" &&
        ts.isVariableDeclaration(parent) &&
        parent.name === node &&
        ts.isVariableStatement(parent.parent.parent) &&
        parent.parent.parent.parent === sourceFile;
      if (!isCallee && !isWrapperImport && !isWriterBinding) {
        issues.push({
          snippet: firstLine(parent, sourceFile),
          reason:
            `${node.text} is used other than as the write-route.ts import or a direct call (a local ` +
            "declaration, alias or pass-through); a look-alike could run code before the write gate.",
        });
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return issues;
}

// Every `writeRoute(...)` call must be exactly (method, path, resolver,
// handler): no extra argument (a middleware would run before the gate), a
// literal method and path, a resolver built by an approved factory (inline or
// via a top-level const) whose own arguments are plain identifiers and a
// string literal, and a function (or a named function) as handler. The call
// itself is a top-level statement, so the identifiers it names resolve at
// module scope. Any other mention of the identifier `writeRoute` (alias,
// detached, passed on) is reported too.
function findWriteRouteShapeViolations(sourceFile: ts.SourceFile): Issue[] {
  const issues: Issue[] = [];

  function visit(node: ts.Node): void {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "writeRoute"
    ) {
      const snippet = firstLine(node, sourceFile);
      const args = node.arguments;
      if (!(ts.isExpressionStatement(node.parent) && node.parent.parent === sourceFile)) {
        issues.push({
          snippet,
          reason:
            "writeRoute must be called as a top-level statement of router.ts, so the identifiers it names " +
            "resolve at module scope and cannot be shadowed.",
        });
      }
      if (args.length !== 4 || args.some((a) => ts.isSpreadElement(a))) {
        issues.push({
          snippet,
          reason:
            "writeRoute takes exactly (method, path, resolveTeam, handler); an extra or spread argument could " +
            "run a middleware before the write gate.",
        });
      } else {
        const [method, routePath, resolver, handler] = args;
        if (!ts.isStringLiteral(method) || !WRITE_ROUTE_METHODS.has(method.text)) {
          issues.push({
            snippet,
            reason: "writeRoute needs a literal post/put/patch/delete method as first argument.",
          });
        }
        if (!ts.isStringLiteral(routePath)) {
          issues.push({
            snippet,
            reason: "writeRoute needs a plain string literal path as second argument.",
          });
        }
        const factory = resolveToCall(resolver, sourceFile);
        if (
          !factory ||
          !ts.isIdentifier(factory.expression) ||
          !RESOLVER_FACTORIES.has(factory.expression.text)
        ) {
          issues.push({
            snippet,
            reason:
              "writeRoute's team resolver must be a teamFromBody(...) or teamFromResource(...) call, inline or " +
              "held in a top-level const; any other function could do work before the write gate.",
          });
        } else {
          const problem = factoryArgumentProblem(factory, sourceFile);
          if (problem) issues.push({ snippet, reason: problem });
        }
        if (!(ts.isArrowFunction(handler) || ts.isFunctionExpression(handler) || ts.isIdentifier(handler))) {
          issues.push({ snippet, reason: "writeRoute's handler must be a function or a named function." });
        }
      }
    } else if (
      ts.isIdentifier(node) &&
      node.text === "writeRoute" &&
      !(ts.isVariableDeclaration(node.parent) && node.parent.name === node) &&
      !(ts.isCallExpression(node.parent) && node.parent.expression === node)
    ) {
      issues.push({
        snippet: firstLine(node.parent ?? node, sourceFile),
        reason:
          "writeRoute is referenced other than by a direct call (alias, detached reference or pass-through); " +
          "the walker cannot see routes registered that way.",
      });
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return issues;
}

// `const writeRoute = createWriteRoute({ router: apiRouter, requireAuth,
// requireTeamWriteRole })` must exist exactly once, at the top level, with
// exactly those three properties: the wrapper is bound to the one router, the
// real auth function and the real write gate (swapping the gate for the
// membership-only requireTeamRole would type-check).
function findWriteRouteBindingViolations(sourceFile: ts.SourceFile): string[] {
  const bindings: ts.VariableDeclaration[] = [];
  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (ts.isIdentifier(declaration.name) && declaration.name.text === "writeRoute")
        bindings.push(declaration);
    }
  }
  if (bindings.length !== 1)
    return [`expected exactly one top-level writeRoute binding, found ${bindings.length}`];
  const init = bindings[0].initializer;
  if (
    !init ||
    !ts.isCallExpression(init) ||
    !ts.isIdentifier(init.expression) ||
    init.expression.text !== "createWriteRoute" ||
    init.arguments.length !== 1 ||
    !ts.isObjectLiteralExpression(init.arguments[0])
  ) {
    return ["writeRoute must be bound with createWriteRoute({ router, requireAuth, requireTeamWriteRole })"];
  }
  const found = new Map<string, string>();
  for (const property of init.arguments[0].properties) {
    if (ts.isShorthandPropertyAssignment(property)) {
      found.set(property.name.text, property.name.text);
    } else if (
      ts.isPropertyAssignment(property) &&
      ts.isIdentifier(property.name) &&
      ts.isIdentifier(property.initializer)
    ) {
      found.set(property.name.text, property.initializer.text);
    } else {
      return [`createWriteRoute got an unrecognized property: ${firstLine(property, sourceFile)}`];
    }
  }
  const expected: Record<string, string> = {
    router: "apiRouter",
    requireAuth: "requireAuth",
    requireTeamWriteRole: "requireTeamWriteRole",
  };
  const violations: string[] = [];
  for (const [name, value] of Object.entries(expected)) {
    if (found.get(name) !== value)
      violations.push(`createWriteRoute property ${name} must be ${value}, got ${found.get(name)}`);
  }
  for (const name of found.keys()) {
    if (!(name in expected)) violations.push(`createWriteRoute has an unexpected property ${name}`);
  }
  return violations;
}

// --- Registrations outside router.ts (S4) ---------------------------------
//
// router.ts is the one place routes are registered, on the one router
// instance. Another module could still add a mutating route that bypasses the
// wrapper: on a second Router(), on apiRouter imported from router.ts, on an
// express app or sub-app, or through a mounted router. This scan is static
// and covers all of src/; it complements the runtime route table (which is
// authoritative for everything createApp() builds, and cannot see code that
// runs outside it, such as a registration on the app in server.ts):
//   - Router() / express.Router() / new Router() is called exactly once, in
//     router.ts;
//   - express() is called only in app.ts (the app) and config/index.ts (a
//     throwaway instance that validates the trust-proxy setting);
//   - createWriteRoute is called exactly once, in router.ts;
//   - outside router.ts nothing calls .post/.put/.patch/.delete/.all/.route
//     with a path, and .use mounts only the two known paths in app.ts (and no
//     bare identifier, which would be a router mounted by reference);
//   - apiRouter is referenced outside router.ts only by app.ts, and there only
//     as the import and as the router of app.use("/api/v1", apiRouter).
const ROUTER_FILE = "api/rest/router.ts";
const APP_FILE = "app.ts";
const EXPRESS_CALL_FILES = new Set([APP_FILE, "config/index.ts"]);
const APP_USE_PATHS = new Set(["/docs", "/api/v1"]);
const MUTATING_REGISTRATION_MEMBERS = new Set(["post", "put", "patch", "delete", "all", "route"]);

function isPathLike(node: ts.Node | undefined): boolean {
  return node !== undefined && (ts.isStringLiteralLike(node) || ts.isTemplateExpression(node));
}

function findRegistrationEscapes(files: Record<string, string>): string[] {
  const violations: string[] = [];
  let routerCalls = 0;
  let writeRouteFactoryCalls = 0;

  for (const [name, source] of Object.entries(files)) {
    const sourceFile = parseSource(name, source);
    const isRouterFile = name === ROUTER_FILE;

    function visit(node: ts.Node): void {
      if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
        const callee = node.expression;
        const args = node.arguments ?? [];
        const calleeName = ts.isIdentifier(callee)
          ? callee.text
          : ts.isPropertyAccessExpression(callee)
            ? callee.name.text
            : undefined;
        if (calleeName === "Router") {
          routerCalls += 1;
          if (!isRouterFile) violations.push(`${name}: creates a Router (${firstLine(node, sourceFile)})`);
        }
        if (ts.isIdentifier(callee) && callee.text === "express" && !EXPRESS_CALL_FILES.has(name)) {
          violations.push(`${name}: creates an express app (${firstLine(node, sourceFile)})`);
        }
        if (ts.isIdentifier(callee) && callee.text === "createWriteRoute") {
          writeRouteFactoryCalls += 1;
          if (!isRouterFile)
            violations.push(`${name}: calls createWriteRoute (${firstLine(node, sourceFile)})`);
        }
        if (ts.isPropertyAccessExpression(callee) && !isRouterFile) {
          const member = callee.name.text;
          if (MUTATING_REGISTRATION_MEMBERS.has(member) && isPathLike(args[0])) {
            violations.push(`${name}: registers a route outside router.ts (${firstLine(node, sourceFile)})`);
          }
          if (member === "use") {
            const [first] = args;
            if (isPathLike(first)) {
              const mountPath = ts.isStringLiteralLike(first) ? first.text : undefined;
              if (!(name === APP_FILE && mountPath !== undefined && APP_USE_PATHS.has(mountPath))) {
                violations.push(
                  `${name}: mounts something at an unexpected path (${firstLine(node, sourceFile)})`,
                );
              }
            } else if (first !== undefined && ts.isIdentifier(first)) {
              violations.push(`${name}: mounts ${first.text} by reference (${firstLine(node, sourceFile)})`);
            }
          }
        }
      }
      if (ts.isIdentifier(node) && node.text === "apiRouter" && !isRouterFile) {
        const parent = node.parent;
        const isImport = ts.isImportSpecifier(parent);
        const isAppMount =
          ts.isCallExpression(parent) &&
          ts.isPropertyAccessExpression(parent.expression) &&
          parent.expression.name.text === "use" &&
          parent.arguments.length === 2 &&
          ts.isStringLiteral(parent.arguments[0]) &&
          parent.arguments[0].text === "/api/v1" &&
          parent.arguments[1] === node;
        if (!(name === APP_FILE && (isImport || isAppMount))) {
          violations.push(`${name}: references apiRouter (${firstLine(parent ?? node, sourceFile)})`);
        }
      }
      ts.forEachChild(node, visit);
    }

    visit(sourceFile);
  }

  if (routerCalls !== 1) violations.push(`expected exactly one Router() call in src, found ${routerCalls}`);
  if (writeRouteFactoryCalls !== 1) {
    violations.push(`expected exactly one createWriteRoute call in src, found ${writeRouteFactoryCalls}`);
  }
  return violations;
}

function readSrcFiles(dir: string = SRC_ROOT): Record<string, string> {
  const files: Record<string, string> = {};
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      Object.assign(files, readSrcFiles(full));
    } else if (entry.isFile() && entry.name.endsWith(".ts")) {
      files[path.relative(SRC_ROOT, full).split(path.sep).join("/")] = readFileSync(full, "utf8");
    }
  }
  return files;
}

function findFunctionDeclarations(sourceFile: ts.SourceFile, name: string): ts.FunctionDeclaration[] {
  const found: ts.FunctionDeclaration[] = [];
  function visit(node: ts.Node): void {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) found.push(node);
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return found;
}

const routerSourceFile = loadRouterSourceFile();
const allRoutes = extractRoutes(routerSourceFile);
const stateChangingRoutes = allRoutes.filter((r) => STATE_CHANGING_METHODS.has(r.method));
const srcFiles = readSrcFiles();

describe("router.ts: every state-changing route is writeRoute-registered or a justified allowlist entry", () => {
  it("found writeRoute and allowlisted routes, with and without a :param (sanity check the AST walk isn't empty)", () => {
    expect(stateChangingRoutes.some((r) => r.via === "writeRoute")).toBe(true);
    expect(stateChangingRoutes.some((r) => r.via === "apiRouter")).toBe(true);
    expect(stateChangingRoutes.some((r) => r.routePath.includes(":"))).toBe(true);
    expect(stateChangingRoutes.some((r) => !r.routePath.includes(":"))).toBe(true);
  });

  it("router.ts has no apiRouter registration shape the AST walker cannot classify", () => {
    expect(
      findUnrecognizedApiRouterUsages(routerSourceFile),
      "Found apiRouter usage(s) the write-role guard's walker does not understand; they would silently escape " +
        "classification below.",
    ).toEqual([]);
  });

  it("every writeRoute call is exactly (method, path, team resolver, handler)", () => {
    expect(findWriteRouteShapeViolations(routerSourceFile)).toEqual([]);
  });

  it("router.ts neither declares nor aliases teamFromBody, teamFromResource, writeRoute or createWriteRoute", () => {
    expect(findWrapperNameShadowing(routerSourceFile)).toEqual([]);
  });

  it("writeRoute is bound to apiRouter with the real requireAuth and requireTeamWriteRole", () => {
    expect(findWriteRouteBindingViolations(routerSourceFile)).toEqual([]);
  });

  it("every state-changing route is classified, and registered the way its classification says", () => {
    const { unclassified, stale, wrongRegistration } = classify(allRoutes, ROUTE_WRITE_GUARDS);
    expect(
      unclassified,
      "New state-changing route(s) in router.ts that are neither registered through writeRoute nor allowlisted. " +
        'Register a team-scoped mutation with writeRoute(...) and add { kind: "write" } to ROUTE_WRITE_GUARDS, ' +
        'or add a justified { kind: "allowlist" } entry for a reading POST, per-user, invite, admin or ingest route.',
    ).toEqual([]);
    expect(
      stale,
      "ROUTE_WRITE_GUARDS has entries for routes no longer present in router.ts. Remove the stale entries.",
    ).toEqual([]);
    expect(wrongRegistration).toEqual([]);
  });

  for (const route of stateChangingRoutes) {
    const key = routeKey(route);
    const guard = ROUTE_WRITE_GUARDS[key];

    it(`${key} is registered the way its guard declares`, () => {
      if (!guard) return; // reported by the classification test above
      if (guard.kind === "write") {
        expect(
          route.via,
          `${key} must be registered through writeRoute(...), not apiRouter.${route.method}`,
        ).toBe("writeRoute");
      } else if (guard.verify) {
        expect(
          routeSatisfiesVerify(route, routerSourceFile, guard.verify),
          `Expected ${key} (allowlisted: ${guard.reason}) to still satisfy its declared guard evidence ` +
            `(${JSON.stringify(guard.verify)}); a mention in a comment does not count.`,
        ).toBe(true);
      }
    });
  }

  it("every allowlist entry carries a substantive justification", () => {
    for (const [key, guard] of Object.entries(ROUTE_WRITE_GUARDS)) {
      if (guard.kind === "allowlist") {
        expect(guard.reason.length, `Allowlist entry for ${key} needs a real justification.`).toBeGreaterThan(
          20,
        );
      }
    }
  });
});

describe("router.ts: the write rule has one home and the wrapper applies it before the handler", () => {
  it("canWrite is declared exactly once", () => {
    expect(findFunctionDeclarations(routerSourceFile, "canWrite")).toHaveLength(1);
  });

  it("requireTeamWriteRole is declared once and its body calls both requireTeamRole and canWrite", () => {
    const decls = findFunctionDeclarations(routerSourceFile, "requireTeamWriteRole");
    expect(decls).toHaveLength(1);
    expect(findCallByCallee(decls[0], routerSourceFile, "requireTeamRole")).not.toBeNull();
    expect(findCallByCallee(decls[0], routerSourceFile, "canWrite")).not.toBeNull();
  });

  it("requireResourceTeam (the read resolver) is membership-only and never claims to be a write gate", () => {
    const decls = findFunctionDeclarations(routerSourceFile, "requireResourceTeam");
    expect(decls).toHaveLength(1);
    expect(findCallByCallee(decls[0], routerSourceFile, "requireTeamRole")).not.toBeNull();
    expect(findCallByCallee(decls[0], routerSourceFile, "requireTeamWriteRole")).toBeNull();
    // The timeline stays readable for a VIEWER: it is the one user of the read resolver.
    expect(routerSourceFile.getText()).toContain("requireIncidentTeam(String(req.params.id), userId, res)");
  });

  it("write-route.ts calls the handler exactly once, and only after the write gate", () => {
    const wrapperPath = path.join(SRC_ROOT, "api/rest/write-route.ts");
    const wrapperFile = parseSource(wrapperPath, readFileSync(wrapperPath, "utf8"));
    const gateCalls: ts.CallExpression[] = [];
    const handlerCalls: ts.CallExpression[] = [];
    (function visit(node: ts.Node): void {
      if (ts.isCallExpression(node)) {
        const callee = node.expression.getText(wrapperFile);
        if (callee === "deps.requireTeamWriteRole") gateCalls.push(node);
        if (callee === "handler") handlerCalls.push(node);
      }
      ts.forEachChild(node, visit);
    })(wrapperFile);
    expect(gateCalls).toHaveLength(1);
    expect(handlerCalls).toHaveLength(1);
    expect(gateCalls[0].getStart()).toBeLessThan(handlerCalls[0].getStart());
  });

  it("no file in src registers a route outside router.ts or on another router instance (S4)", () => {
    expect(findRegistrationEscapes(srcFiles)).toEqual([]);
  });
});

// --- Controls ---------------------------------------------------------------
//
// Synthetic registrations run through the same functions the real router.ts
// goes through. The positive controls pin what is accepted; each negative
// control is a way a VIEWER could still reach a mutation.
const NO_GUARDS: Record<string, Guard> = {};

function routesOf(source: string): RouteDecl[] {
  return extractRoutes(parseSource("synthetic.ts", source));
}

describe("a new mutating route without the wrapper and without an allowlist entry is caught, whatever its shape", () => {
  it("S0: a side effect in the arguments of an inline gate call", () => {
    const { unclassified } = classify(
      routesOf(`
        apiRouter.post("/widgets", asyncHandler(async (req, res) => {
          const userId = await requireAuth(req, res);
          if (userId === null) return;
          if ((await requireTeamWriteRole(userId, (await prisma.widget.create({ data: {} }), req.body.teamId), res)) === null) return;
          await prisma.widget.create({ data: {} });
        }));`),
      NO_GUARDS,
    );
    expect(unclassified).toEqual(["POST /widgets"]);
  });

  it("S1: a mutating middleware argument before the handler", () => {
    const { unclassified } = classify(
      routesOf(`
        apiRouter.delete("/widgets/:id", mutatingMiddleware, asyncHandler(async (req, res) => {
          const userId = await requireAuth(req, res);
          if (userId === null) return;
          if ((await requireTeamWriteRole(userId, req.body.teamId, res)) === null) return;
        }));`),
      NO_GUARDS,
    );
    expect(unclassified).toEqual(["DELETE /widgets/:id"]);
  });

  it("S2: a default-parameter initializer on the handler", () => {
    const { unclassified } = classify(
      routesOf(`
        apiRouter.put("/widgets/:id", asyncHandler(async (req, res, hook = prisma.widget.deleteMany()) => {
          const userId = await requireAuth(req, res);
          if (userId === null) return;
          if ((await requireTeamWriteRole(userId, req.body.teamId, res)) === null) return;
        }));`),
      NO_GUARDS,
    );
    expect(unclassified).toEqual(["PUT /widgets/:id"]);
  });

  it("S3: a tagged template or new expression before the gate", () => {
    const { unclassified } = classify(
      routesOf(`
        apiRouter.patch("/widgets/:id", asyncHandler(async (req, res) => {
          const userId = await requireAuth(req, res);
          if (userId === null) return;
          audit\`touch \${req.params.id}\`;
          new Sender().send();
          if ((await requireTeamWriteRole(userId, req.body.teamId, res)) === null) return;
        }));`),
      NO_GUARDS,
    );
    expect(unclassified).toEqual(["PATCH /widgets/:id"]);
  });

  it("a plain new POST route is unclassified (the baseline CI-red case)", () => {
    const { unclassified } = classify(
      routesOf(`apiRouter.post("/widgets", asyncHandler(async () => {}));`),
      NO_GUARDS,
    );
    expect(unclassified).toEqual(["POST /widgets"]);
  });

  it('a route moved back from writeRoute to apiRouter.post is caught by its "write" classification', () => {
    const { wrongRegistration } = classify(
      routesOf(`apiRouter.post("/sources", asyncHandler(async () => {}));`),
      { "POST /sources": { kind: "write" } },
    );
    expect(wrongRegistration).toHaveLength(1);
  });

  it("an allowlisted route that moves onto writeRoute must be reclassified", () => {
    const { wrongRegistration } = classify(
      routesOf(`writeRoute("post", "/widgets", teamFromBody(widgetSchema), async () => {});`),
      { "POST /widgets": { kind: "allowlist", reason: "a justification that is long enough" } },
    );
    expect(wrongRegistration).toHaveLength(1);
  });

  it("a writeRoute registration is classified and extracted like an apiRouter one (positive control)", () => {
    const routes = routesOf(`writeRoute("post", "/widgets", teamFromBody(widgetSchema), async () => {});`);
    expect(routes.map((r) => [routeKey(r), r.via])).toEqual([["POST /widgets", "writeRoute"]]);
    expect(classify(routes, { "POST /widgets": { kind: "write" } })).toEqual({
      unclassified: [],
      stale: [],
      wrongRegistration: [],
    });
  });
});

describe("writeRoute call shapes", () => {
  // What router.ts has in scope: the wrapper imports, a body schema imported
  // from validation/schemas and a top-level loader.
  const PREAMBLE = `
    import { createWriteRoute, teamFromBody, teamFromResource } from "./write-route.js";
    import { schema, otherSchema } from "../../validation/schemas.js";
    const loadWidgetTeamId = async (id: string) => null;
  `;

  function violations(source: string): Issue[] {
    return findWriteRouteShapeViolations(parseSource("synthetic.ts", PREAMBLE + source));
  }

  it("accepts the four-argument form with an inline resolver (positive control)", () => {
    expect(
      violations(`writeRoute("post", "/w", teamFromBody(schema), async ({ res }) => { res.end(); });`),
    ).toEqual([]);
  });

  it("accepts a resolver held in a top-level const and a named handler (positive control)", () => {
    expect(
      violations(`
        const widgetTeam = teamFromResource(loadWidgetTeamId, "Widget not found");
        writeRoute("delete", "/w/:id", widgetTeam, removeWidget);`),
    ).toEqual([]);
  });

  it("accepts a loader plus a message plus an imported body schema (positive control)", () => {
    expect(
      violations(
        `writeRoute("put", "/w/:id", teamFromResource(loadWidgetTeamId, "Widget not found", otherSchema), async () => {});`,
      ),
    ).toEqual([]);
  });

  it("S1: rejects a middleware argument before the handler (negative control)", () => {
    expect(
      violations(`writeRoute("post", "/w", teamFromBody(schema), mutatingMiddleware, async () => {});`),
    ).toHaveLength(1);
  });

  it("S1: rejects a spread argument (negative control)", () => {
    expect(violations(`writeRoute("post", "/w", ...rest);`).length).toBeGreaterThan(0);
  });

  it("S0: rejects a resolver that is an arbitrary function (negative control)", () => {
    expect(
      violations(
        `writeRoute("post", "/w", async (req, res) => ({ teamId: await sideEffect(), input: 1 }), async () => {});`,
      ),
    ).toHaveLength(1);
  });

  it("rejects a resolver identifier that is not a factory result (negative control)", () => {
    expect(
      violations(`
        const widgetTeam = async (req, res) => null;
        writeRoute("post", "/w", widgetTeam, async () => {});`),
    ).toHaveLength(1);
  });

  it("rejects a get method, a template path and a handler that is a call (negative controls)", () => {
    expect(violations(`writeRoute("get", "/w", teamFromBody(schema), async () => {});`)).toHaveLength(1);
    // eslint-disable-next-line no-template-curly-in-string
    expect(violations('writeRoute("post", `/w/${id}`, teamFromBody(schema), async () => {});')).toHaveLength(
      1,
    );
    expect(violations(`writeRoute("post", "/w", teamFromBody(schema), makeHandler());`)).toHaveLength(1);
  });

  it("rejects an alias or pass-through of writeRoute (negative control)", () => {
    expect(violations(`const route = writeRoute;`)).toHaveLength(1);
    expect(violations(`register(writeRoute);`)).toHaveLength(1);
  });

  it("does not flag the binding itself (negative control)", () => {
    expect(
      violations(
        `const writeRoute = createWriteRoute({ router: apiRouter, requireAuth, requireTeamWriteRole });`,
      ),
    ).toEqual([]);
  });

  it("rejects a writeRoute call that is not a top-level statement (negative control)", () => {
    expect(
      violations(`
        function register() {
          const schema = z.object({}).transform(() => sideEffect());
          writeRoute("post", "/w", teamFromBody(schema), async () => {});
        }`),
    ).not.toEqual([]);
    expect(violations(`{ writeRoute("post", "/w", teamFromBody(schema), async () => {}); }`)).not.toEqual([]);
  });
});

// The arguments of a resolver factory are the code a route supplies that runs
// before the write gate: the body schema (with its transforms and
// refinements) and the loader. Inline expressions in those slots were an
// unchecked pre-gate side-effect path.
describe("resolver factory arguments run before the write gate, so only named, reviewable code may sit there", () => {
  const PREAMBLE = `
    import { createWriteRoute, teamFromBody, teamFromResource } from "./write-route.js";
    import { schema, otherSchema } from "../../validation/schemas.js";
    import { prisma } from "../../repositories/prisma.js";
    const loadWidgetTeamId = async (id: string) => null;
    const loadViaCall = makeLoader();
    async function loadDeclared(id: string) { return null; }
    const localSchema = z.object({ teamId: z.string() });
  `;

  function violations(source: string): Issue[] {
    return findWriteRouteShapeViolations(parseSource("synthetic.ts", PREAMBLE + source));
  }

  it("a side-effecting transform written inline on the body schema is rejected", () => {
    expect(
      violations(
        `writeRoute("post", "/w", teamFromBody(schema.transform((v) => { void prisma.widget.delete({}); return v; })), async () => {});`,
      ),
    ).toHaveLength(1);
  });

  it("a refinement or preprocess call, an object with safeParse and a local schema are rejected", () => {
    expect(
      violations(`writeRoute("post", "/w", teamFromBody(schema.refine(sideEffect)), async () => {});`),
    ).toHaveLength(1);
    expect(
      violations(
        `writeRoute("post", "/w", teamFromBody({ safeParse: (v) => sideEffect(v) }), async () => {});`,
      ),
    ).toHaveLength(1);
    expect(violations(`writeRoute("post", "/w", teamFromBody(localSchema), async () => {});`)).toHaveLength(
      1,
    );
  });

  it("an inline body schema on teamFromResource is rejected", () => {
    expect(
      violations(
        `writeRoute("put", "/w/:id", teamFromResource(loadWidgetTeamId, "Not found", schema.transform(sideEffect)), async () => {});`,
      ),
    ).toHaveLength(1);
  });

  it("an inline loader, a loader from a call and a loader that is not a const arrow are rejected", () => {
    expect(
      violations(
        `writeRoute("delete", "/w/:id", teamFromResource(async (id) => { await sideEffect(id); return null; }, "Not found"), async () => {});`,
      ),
    ).toHaveLength(1);
    expect(
      violations(
        `writeRoute("delete", "/w/:id", teamFromResource(loadViaCall, "Not found"), async () => {});`,
      ),
    ).toHaveLength(1);
    expect(
      violations(
        `writeRoute("delete", "/w/:id", teamFromResource(loadDeclared, "Not found"), async () => {});`,
      ),
    ).toHaveLength(1);
  });

  it("a message that is not a string literal and a wrong argument count are rejected", () => {
    expect(
      violations(
        `writeRoute("delete", "/w/:id", teamFromResource(loadWidgetTeamId, message), async () => {});`,
      ),
    ).toHaveLength(1);
    expect(
      violations(`writeRoute("delete", "/w/:id", teamFromResource(loadWidgetTeamId), async () => {});`),
    ).toHaveLength(1);
    expect(violations(`writeRoute("post", "/w", teamFromBody(), async () => {});`)).toHaveLength(1);
    expect(
      violations(`writeRoute("post", "/w", teamFromBody(schema, otherSchema), async () => {});`),
    ).toHaveLength(1);
  });

  it("a resolver const built from an inline schema is rejected where it is used", () => {
    expect(
      violations(`
        const widgetTeam = teamFromBody(schema.transform(sideEffect));
        writeRoute("post", "/w", widgetTeam, async () => {});`),
    ).toHaveLength(1);
  });

  it("a renamed schema import is rejected (the checked name must be the imported one)", () => {
    const issues = findWriteRouteShapeViolations(
      parseSource(
        "synthetic.ts",
        `
        import { teamFromBody } from "./write-route.js";
        import { schema as renamed } from "../../validation/schemas.js";
        writeRoute("post", "/w", teamFromBody(renamed), async () => {});`,
      ),
    );
    expect(issues).toHaveLength(1);
  });
});

describe("router.ts may not shadow or alias the wrapper names (look-alike factories)", () => {
  function shadowing(source: string): Issue[] {
    return findWrapperNameShadowing(parseSource("synthetic.ts", source));
  }

  const IMPORTS = `import { createWriteRoute, teamFromBody, teamFromResource } from "./write-route.js";`;

  it("the real shapes are accepted: the imports, the binding and direct calls (positive control)", () => {
    expect(
      shadowing(`
        ${IMPORTS}
        const writeRoute = createWriteRoute({ router: apiRouter, requireAuth, requireTeamWriteRole });
        writeRoute("post", "/w", teamFromBody(schema), async () => {});
        writeRoute("put", "/w/:id", teamFromResource(load, "Not found"), async () => {});`),
    ).toEqual([]);
  });

  it("a locally shadowed teamFromBody in a nested block is rejected", () => {
    expect(
      shadowing(`
        ${IMPORTS}
        {
          const teamFromBody = (schema) => async () => ({ teamId: sideEffect(), input: 1 });
          writeRoute("post", "/w", teamFromBody(schema), async () => {});
        }`),
    ).not.toEqual([]);
  });

  it("a function, parameter, class or renamed import with a wrapper name is rejected", () => {
    expect(shadowing(`function teamFromResource(load, message) { return sideEffect(); }`)).not.toEqual([]);
    expect(shadowing(`const register = (writeRoute) => writeRoute("post", "/w", a, b);`)).not.toEqual([]);
    expect(shadowing(`import { teamFromBody as teamFromBody2 } from "./write-route.js";`)).not.toEqual([]);
    expect(shadowing(`import { teamFromBody } from "./elsewhere.js";`)).not.toEqual([]);
  });

  it("a nested writeRoute binding and a detached createWriteRoute are rejected", () => {
    expect(shadowing(`{ const writeRoute = (...args) => {}; }`)).not.toEqual([]);
    expect(shadowing(`const factory = createWriteRoute;`)).not.toEqual([]);
  });
});

describe("the writeRoute binding", () => {
  function bindingViolations(source: string): string[] {
    return findWriteRouteBindingViolations(parseSource("synthetic.ts", source));
  }

  it("accepts the real binding shape (positive control)", () => {
    expect(
      bindingViolations(
        `const writeRoute = createWriteRoute({ router: apiRouter, requireAuth, requireTeamWriteRole });`,
      ),
    ).toEqual([]);
  });

  it("rejects the membership-only gate in place of the write gate (negative control)", () => {
    expect(
      bindingViolations(
        `const writeRoute = createWriteRoute({ router: apiRouter, requireAuth, requireTeamWriteRole: requireTeamRole });`,
      ).length,
    ).toBeGreaterThan(0);
  });

  it("rejects another router instance (negative control)", () => {
    expect(
      bindingViolations(
        `const writeRoute = createWriteRoute({ router: otherRouter, requireAuth, requireTeamWriteRole });`,
      ).length,
    ).toBeGreaterThan(0);
  });

  it("rejects a missing binding (negative control)", () => {
    expect(bindingViolations(`const x = 1;`).length).toBeGreaterThan(0);
  });

  it("rejects a duplicated binding (negative control)", () => {
    expect(
      bindingViolations(`
        const writeRoute = createWriteRoute({ router: apiRouter, requireAuth, requireTeamWriteRole });
        const writeRoute = createWriteRoute({ router: apiRouter, requireAuth, requireTeamWriteRole });
      `).length,
    ).toBeGreaterThan(0);
  });

  it("ignores a same-named binding nested in a block (it is not the top-level wrapper)", () => {
    expect(
      bindingViolations(`
        const writeRoute = createWriteRoute({ router: apiRouter, requireAuth, requireTeamWriteRole });
        { const writeRoute = 2; }
      `),
    ).toEqual([]);
  });
});

describe("S4: registrations outside router.ts are detected", () => {
  const ROUTER_OK = `
    export const apiRouter = Router();
    const writeRoute = createWriteRoute({ router: apiRouter, requireAuth, requireTeamWriteRole });
  `;
  const APP_OK = `
    import { apiRouter } from "./api/rest/router.js";
    const app = express();
    app.use("/docs", swaggerUi.serve);
    app.use("/api/v1", apiRouter);
  `;
  const BASE: Record<string, string> = { [ROUTER_FILE]: ROUTER_OK, [APP_FILE]: APP_OK };

  it("the unmodified shape is clean (positive control)", () => {
    expect(findRegistrationEscapes(BASE)).toEqual([]);
  });

  it("a second Router() instance in another module", () => {
    expect(
      findRegistrationEscapes({
        ...BASE,
        "api/rest/extra.ts": `const second = Router(); second.post("/widgets", handler);`,
      }),
    ).not.toEqual([]);
    expect(
      findRegistrationEscapes({ ...BASE, "api/rest/extra.ts": `const second = express.Router();` }),
    ).not.toEqual([]);
  });

  it("apiRouter imported and used from another module", () => {
    expect(
      findRegistrationEscapes({
        ...BASE,
        "api/rest/extra.ts": `import { apiRouter } from "./router.js"; apiRouter.post("/widgets", handler);`,
      }),
    ).not.toEqual([]);
  });

  it("a mutating route registered on the express app", () => {
    expect(
      findRegistrationEscapes({ ...BASE, [APP_FILE]: `${APP_OK}\napp.post("/widgets", handler);` }),
    ).not.toEqual([]);
  });

  it("a router mounted at another path or by reference", () => {
    expect(
      findRegistrationEscapes({ ...BASE, [APP_FILE]: `${APP_OK}\napp.use("/extra", extraRouter);` }),
    ).not.toEqual([]);
    expect(findRegistrationEscapes({ ...BASE, [APP_FILE]: `${APP_OK}\napp.use(extraRouter);` })).not.toEqual(
      [],
    );
  });

  it("an extra createWriteRoute binding on another router", () => {
    expect(
      findRegistrationEscapes({
        ...BASE,
        "api/rest/extra.ts": `const r = createWriteRoute({ router: other, requireAuth, requireTeamWriteRole });`,
      }),
    ).not.toEqual([]);
  });

  it("a second express app outside app.ts and config/index.ts", () => {
    expect(findRegistrationEscapes({ ...BASE, "api/rest/extra.ts": `const sub = express();` })).not.toEqual(
      [],
    );
  });

  it("the real src tree passes the scan, and the scan sees the real files (sanity check)", () => {
    expect(Object.keys(srcFiles)).toEqual(
      expect.arrayContaining([ROUTER_FILE, APP_FILE, "api/rest/write-route.ts"]),
    );
  });
});
