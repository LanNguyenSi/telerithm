import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import ts from "typescript";

// Shared AST walker for the two router meta-tests (router-write-role.test.ts
// and router-team-scoping.test.ts). Both parse router.ts with the TypeScript
// compiler API instead of importing it: importing would construct live
// Prisma/ClickHouse/Redis-backed services as a module-load side effect.
//
// A route is registered in exactly one of two ways in router.ts:
//   apiRouter.<method>("path", ...)              any route, incl. reads
//   writeRoute("<method>", "path", resolve, fn)  team-scoped mutating routes;
//                                                see src/api/rest/write-route.ts
// Both are extracted into the same RouteDecl shape. Everything that registers
// a route in some other way is reported by findUnrecognizedApiRouterUsages (or
// by the write-role test's registration scan) rather than silently skipped.

export const ROUTER_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../src/api/rest/router.ts",
);

export const STATE_CHANGING_METHODS = new Set(["post", "put", "patch", "delete"]);
export const HTTP_METHOD_NAMES = new Set(["get", "post", "put", "patch", "delete"]);

export type Verify =
  | { type: "call"; callee: string; alsoReferences?: string }
  | { type: "identifier"; name: string };

export interface RouteDecl {
  method: string;
  routePath: string;
  // How the route was registered.
  via: "apiRouter" | "writeRoute";
  // Argument nodes after the path string, kept as AST nodes (not text) so
  // verification walks real CallExpression/Identifier nodes and a comment
  // mentioning a gate name can never satisfy it. For writeRoute these are
  // [resolveTeam, handler, ...anything extra].
  argNodes: ts.Expression[];
}

export function parseSource(fileName: string, source: string): ts.SourceFile {
  return ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
}

export function loadRouterSourceFile(): ts.SourceFile {
  return parseSource(ROUTER_PATH, readFileSync(ROUTER_PATH, "utf8"));
}

export function routeKey(route: RouteDecl): string {
  return `${route.method.toUpperCase()} ${route.routePath}`;
}

export function extractRoutes(sourceFile: ts.SourceFile): RouteDecl[] {
  const routes: RouteDecl[] = [];

  function visit(node: ts.Node): void {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ts.isIdentifier(node.expression.expression) &&
      node.expression.expression.text === "apiRouter" &&
      HTTP_METHOD_NAMES.has(node.expression.name.text.toLowerCase())
    ) {
      const [pathArg, ...rest] = node.arguments;
      if (pathArg && ts.isStringLiteral(pathArg)) {
        routes.push({
          method: node.expression.name.text.toLowerCase(),
          routePath: pathArg.text,
          via: "apiRouter",
          argNodes: rest,
        });
      }
    } else if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "writeRoute"
    ) {
      const [methodArg, pathArg, ...rest] = node.arguments;
      if (
        methodArg &&
        pathArg &&
        ts.isStringLiteral(methodArg) &&
        HTTP_METHOD_NAMES.has(methodArg.text.toLowerCase()) &&
        ts.isStringLiteral(pathArg)
      ) {
        routes.push({
          method: methodArg.text.toLowerCase(),
          routePath: pathArg.text,
          via: "writeRoute",
          argNodes: rest,
        });
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return routes;
}

// True for the positions of the `apiRouter` identifier that are not an escape
// hatch: its own declaration, the object of a property access that is itself
// the callee of a call (`apiRouter.get(...)`, `apiRouter.use(...)`; whether
// the member is a supported method is judged by the caller), and the `router`
// property of the single object argument of `createWriteRoute({...})`, which
// binds the wrapper to this one router instance (the write-role test pins
// that there is exactly one such call).
function isRecognizedApiRouterReference(identifier: ts.Identifier): boolean {
  const parent = identifier.parent;
  if (ts.isVariableDeclaration(parent) && parent.name === identifier) return true;
  if (
    ts.isPropertyAssignment(parent) &&
    parent.initializer === identifier &&
    ts.isIdentifier(parent.name) &&
    parent.name.text === "router" &&
    ts.isObjectLiteralExpression(parent.parent) &&
    ts.isCallExpression(parent.parent.parent) &&
    ts.isIdentifier(parent.parent.parent.expression) &&
    parent.parent.parent.expression.text === "createWriteRoute" &&
    parent.parent.parent.arguments.length === 1
  ) {
    return true;
  }
  return (
    ts.isPropertyAccessExpression(parent) &&
    parent.expression === identifier &&
    ts.isCallExpression(parent.parent) &&
    parent.parent.expression === parent
  );
}

// `apiRouter.<member>(...)` shapes extractRoutes does not understand (.route()
// chaining, .use() sub-router mounts, a non-literal path) and every other
// reference to the `apiRouter` identifier (alias, element access, detached
// method, destructuring, pass-through) would silently escape classification,
// so they are reported as data for a test assertion.
export function findUnrecognizedApiRouterUsages(
  sourceFile: ts.SourceFile,
): Array<{ snippet: string; reason: string }> {
  const issues: Array<{ snippet: string; reason: string }> = [];

  function visit(node: ts.Node): void {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ts.isIdentifier(node.expression.expression) &&
      node.expression.expression.text === "apiRouter"
    ) {
      const member = node.expression.name.text;
      const snippet = node.getText(sourceFile).split("\n")[0].trim();
      if (!HTTP_METHOD_NAMES.has(member.toLowerCase())) {
        issues.push({
          snippet,
          reason:
            `apiRouter.${member}(...) is not one of get/post/put/patch/delete; extractRoutes would silently skip ` +
            "it (.route() chaining, .use() sub-router mounting). Extend extractRoutes and classify any " +
            "resulting routes.",
        });
      } else {
        const [pathArg] = node.arguments;
        if (!pathArg || !ts.isStringLiteral(pathArg)) {
          issues.push({
            snippet,
            reason:
              `apiRouter.${member}(...) has no plain string literal as its first argument; extractRoutes cannot ` +
              "extract a path from it and would silently skip it.",
          });
        }
      }
    }
    if (ts.isIdentifier(node) && node.text === "apiRouter" && !isRecognizedApiRouterReference(node)) {
      issues.push({
        snippet: (node.parent ?? node).getText(sourceFile).split("\n")[0].trim(),
        reason:
          "apiRouter is referenced in a position other than its declaration or an `apiRouter.<method>(` call " +
          "(an alias, element access such as apiRouter['delete'](...), a detached method or a pass-through). " +
          "extractRoutes would silently skip routes registered that way. Register routes with a direct " +
          'apiRouter.<method>("path", ...) call or, for a team-scoped mutating route, with writeRoute(...).',
      });
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return issues;
}

// First CallExpression in `root`'s subtree whose callee's exact source text
// equals `calleeText`. Comments are trivia, not AST nodes, so a comment
// mentioning the name cannot match.
export function findCallByCallee(
  root: ts.Node,
  sourceFile: ts.SourceFile,
  calleeText: string,
): ts.CallExpression | null {
  let match: ts.CallExpression | null = null;

  function visit(node: ts.Node): void {
    if (match) return;
    if (ts.isCallExpression(node) && node.expression.getText(sourceFile) === calleeText) {
      match = node;
      return;
    }
    ts.forEachChild(node, visit);
  }

  visit(root);
  return match;
}

// True if `root`'s subtree contains an Identifier node with text `name`
// (a reference, not a comment).
export function containsIdentifier(root: ts.Node, name: string): boolean {
  let found = false;

  function visit(node: ts.Node): void {
    if (found) return;
    if (ts.isIdentifier(node) && node.text === name) {
      found = true;
      return;
    }
    ts.forEachChild(node, visit);
  }

  visit(root);
  return found;
}

export function routeSatisfiesVerify(route: RouteDecl, sourceFile: ts.SourceFile, verify: Verify): boolean {
  if (verify.type === "identifier") {
    return route.argNodes.some((node) => containsIdentifier(node, verify.name));
  }
  for (const node of route.argNodes) {
    const call = findCallByCallee(node, sourceFile, verify.callee);
    if (call) {
      return verify.alsoReferences ? containsIdentifier(call, verify.alsoReferences) : true;
    }
  }
  return false;
}

// Follows a writeRoute resolver argument to the factory call that builds it:
// the inline call itself, or the initializer of the top-level `const` an
// identifier names. Null for any other form.
export function resolveToCall(
  expression: ts.Expression,
  sourceFile: ts.SourceFile,
): ts.CallExpression | null {
  if (ts.isCallExpression(expression)) return expression;
  if (ts.isIdentifier(expression)) {
    for (const statement of sourceFile.statements) {
      if (!ts.isVariableStatement(statement)) continue;
      for (const declaration of statement.declarationList.declarations) {
        if (
          ts.isIdentifier(declaration.name) &&
          declaration.name.text === expression.text &&
          declaration.initializer &&
          ts.isCallExpression(declaration.initializer)
        ) {
          return declaration.initializer;
        }
      }
    }
  }
  return null;
}

// The factory call (`teamFromBody(...)` / `teamFromResource(...)`) that builds
// a writeRoute route's team resolver. Null when the route is not a writeRoute
// route or the resolver is neither form.
export function findResolverFactoryCall(
  route: RouteDecl,
  sourceFile: ts.SourceFile,
): ts.CallExpression | null {
  if (route.via !== "writeRoute") return null;
  const resolver = route.argNodes[0];
  return resolver ? resolveToCall(resolver, sourceFile) : null;
}
