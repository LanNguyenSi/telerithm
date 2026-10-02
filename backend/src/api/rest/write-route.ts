import type { NextFunction, Request, Response, Router } from "express";

// Structural enforcement of the team write rule ("VIEWER is read-only on
// team-scoped writes", see canWrite in router.ts and ENGINEERING.md).
//
// A team-scoped mutating route is registered through `writeRoute(method, path,
// resolveTeam, handler)` and nowhere else. The wrapper runs, in this fixed
// order and before the handler is ever called:
//
//   1. authentication            (401, handler not called)
//   2. team resolution           (400 invalid body / 404 unknown resource)
//   3. the team write gate       (403 for a non-member or a read-only role)
//   4. the handler
//
// The handler is invoked from exactly one place, after step 3, and receives
// the authenticated user, the resolved team and the gate's role as arguments.
// A route author cannot reorder or skip the steps because:
//   - the signature has no middleware argument, so nothing can run between the
//     router and the gate (a fifth argument is a type error, and the meta-test
//     in tests/unit/router-write-role.test.ts rejects it even under a cast);
//   - the gate call lives in this module with fixed arguments, so a route
//     cannot hang a side effect on the gate's arguments;
//   - the handler (with its default-parameter initializers, tagged templates,
//     `new` expressions and statements) is only called by the wrapper, after
//     the gate.
//
// Two route-supplied inputs DO run before the gate, because the gate needs the
// team they produce, and the wrapper cannot sandbox them:
//   - the loader given to `teamFromResource` (a lookup of the resource's team);
//   - the body schema given to `teamFromBody` / `teamFromResource`, including
//     any transform, refinement or preprocess step it carries, since the body
//     is parsed to find or validate the team.
// Both must be free of side effects. The meta-test accepts only plain
// identifiers there (a schema imported from validation/schemas, a loader held
// in a top-level const) and a string literal message, so neither can be an
// inline expression; what those named functions do is code review's job.
//
// The registered Express handler is tagged (`isWriteRouteHandler`) so a
// runtime route-table test can verify that a team-scoped write route is served
// by this wrapper and by nothing else, whatever spelling registered it.
//
// This module takes its collaborators as arguments (`createWriteRoute`) so it
// can be unit-tested without constructing the live Prisma/ClickHouse/Redis
// backed services router.ts builds at module load.

export type TeamRoleName = "OWNER" | "ADMIN" | "MEMBER" | "VIEWER";

export type WriteMethod = "post" | "put" | "patch" | "delete";

// The part of a Zod schema the resolvers need. Structural on purpose, so any
// `z.object(...)` satisfies it without this module importing Zod.
export interface BodySchema<T> {
  safeParse(data: unknown): { success: true; data: T } | { success: false; error: { flatten(): unknown } };
}

// What team resolution yields: the team the request acts on, plus any value
// the resolver derived on the way (the validated body) for the handler.
export interface TeamTarget<TInput> {
  teamId: string;
  input: TInput;
}

// Resolves the team a request acts on. It runs after authentication and
// before the write gate, so everything it calls (the body schema with its
// transforms and refinements, the loader) must be free of side effects: it
// answers 400/404 itself and returns null when it did. Build resolvers with
// `teamFromBody` and `teamFromResource`; the meta-test accepts no other form.
export type ResolveTeam<TInput> = (req: Request, res: Response) => Promise<TeamTarget<TInput> | null>;

export interface WriteContext<TInput> {
  req: Request;
  res: Response;
  userId: string;
  teamId: string;
  role: TeamRoleName;
  input: TInput;
}

export type WriteHandler<TInput> = (context: WriteContext<TInput>) => Promise<unknown>;

export interface WriteRouteDeps {
  router: Pick<Router, WriteMethod>;
  // Sends 401 and returns null when the caller is not authenticated.
  requireAuth: (req: Request, res: Response) => Promise<string | null>;
  // Sends 403 and returns null for a non-member or a read-only role.
  requireTeamWriteRole: (userId: string, teamId: string, res: Response) => Promise<TeamRoleName | null>;
}

export type WriteRoute = <TInput>(
  method: WriteMethod,
  path: string,
  resolveTeam: ResolveTeam<TInput>,
  handler: WriteHandler<TInput>,
) => void;

// Handlers this module registered. Only createWriteRoute adds to the set, so
// membership proves a route handler is the wrapper's, not a look-alike.
const writeRouteHandlers = new WeakSet<object>();

export function isWriteRouteHandler(candidate: unknown): boolean {
  return typeof candidate === "function" && writeRouteHandlers.has(candidate);
}

export function createWriteRoute(deps: WriteRouteDeps): WriteRoute {
  return function writeRoute<TInput>(
    method: WriteMethod,
    path: string,
    resolveTeam: ResolveTeam<TInput>,
    handler: WriteHandler<TInput>,
  ): void {
    const registered = (req: Request, res: Response, next: NextFunction): void => {
      const run = async (): Promise<void> => {
        const userId = await deps.requireAuth(req, res);
        if (userId === null) return;
        const target = await resolveTeam(req, res);
        if (target === null) return;
        const role = await deps.requireTeamWriteRole(userId, target.teamId, res);
        if (role === null) return;
        await handler({ req, res, userId, teamId: target.teamId, role, input: target.input });
      };
      run().catch(next);
    };
    writeRouteHandlers.add(registered);
    deps.router[method](path, registered);
  };
}

// Team resolver for a route that names its team in the request body (POST
// /sources, POST /maintenance-windows): validates the body (400 with the
// flattened Zod error) and takes `teamId` from it. The handler receives the
// validated body as `input`. The schema runs before the gate, so it must be
// free of side effects (see the header).
export function teamFromBody<T extends { teamId: string }>(schema: BodySchema<T>): ResolveTeam<T> {
  return async (req, res) => {
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return null;
    }
    return { teamId: parsed.data.teamId, input: parsed.data };
  };
}

// Team resolver for a by-id route: loads the resource named by the `:id` path
// parameter and takes the team that owns it (404 when the resource does not
// exist). With a `bodySchema` the body is validated first (400) and handed to
// the handler as `input`; without one, `input` is undefined and the handler
// parses what it needs. `loadTeamId` and `bodySchema` run before the gate and
// must be free of side effects (see the header).
export function teamFromResource(
  loadTeamId: (id: string) => Promise<string | null>,
  notFoundMessage: string,
): ResolveTeam<undefined>;
export function teamFromResource<T>(
  loadTeamId: (id: string) => Promise<string | null>,
  notFoundMessage: string,
  bodySchema: BodySchema<T>,
): ResolveTeam<T>;
export function teamFromResource<T>(
  loadTeamId: (id: string) => Promise<string | null>,
  notFoundMessage: string,
  bodySchema?: BodySchema<T>,
): ResolveTeam<T | undefined> {
  return async (req, res) => {
    let input: T | undefined;
    if (bodySchema) {
      const parsed = bodySchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.flatten() });
        return null;
      }
      input = parsed.data;
    }
    const teamId = await loadTeamId(String(req.params.id));
    if (teamId === null) {
      res.status(404).json({ error: notFoundMessage });
      return null;
    }
    return { teamId, input };
  };
}
