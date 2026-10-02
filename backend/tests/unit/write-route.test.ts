import { describe, expect, it, vi } from "vitest";
import express, { Router, type NextFunction, type Request, type Response } from "express";
import supertest from "supertest";
import { z } from "zod";
import {
  createWriteRoute,
  teamFromBody,
  teamFromResource,
  type TeamRoleName,
  type WriteMethod,
  type WriteRouteDeps,
} from "../../src/api/rest/write-route.js";

// Behavioural proof that writeRoute puts authentication, team resolution and
// the write gate in front of the handler, and that the handler has no way
// around them. router-write-role.test.ts makes the wrapper mandatory for every
// team-scoped mutating route; this file proves what the wrapper then does.

type Event = string;

interface Harness {
  events: Event[];
  deps: WriteRouteDeps;
  registered: Array<{ method: WriteMethod; path: string; handlers: unknown[] }>;
  // Drives the single handler a registration produced, like Express would.
  invoke: (
    index: number,
    req?: Partial<Request>,
  ) => Promise<{ res: FakeRes; next: ReturnType<typeof vi.fn> }>;
}

interface FakeRes {
  statusCode: number | undefined;
  body: unknown;
  status: (code: number) => FakeRes;
  json: (body: unknown) => FakeRes;
  end: () => FakeRes;
}

function fakeRes(): FakeRes {
  const res: FakeRes = {
    statusCode: undefined,
    body: undefined,
    status(code) {
      res.statusCode = code;
      return res;
    },
    json(body) {
      res.body = body;
      return res;
    },
    end() {
      return res;
    },
  };
  return res;
}

interface Options {
  authUserId?: string | null;
  gate?: (userId: string, teamId: string, res: Response) => Promise<TeamRoleName | null>;
}

function harness(options: Options = {}): Harness {
  const events: Event[] = [];
  const registered: Harness["registered"] = [];
  const router = {
    post: (path: string, ...handlers: unknown[]) => registered.push({ method: "post", path, handlers }),
    put: (path: string, ...handlers: unknown[]) => registered.push({ method: "put", path, handlers }),
    patch: (path: string, ...handlers: unknown[]) => registered.push({ method: "patch", path, handlers }),
    delete: (path: string, ...handlers: unknown[]) => registered.push({ method: "delete", path, handlers }),
  } as unknown as WriteRouteDeps["router"];
  const authUserId = options.authUserId === undefined ? "user-1" : options.authUserId;
  const deps: WriteRouteDeps = {
    router,
    requireAuth: async (_req, res) => {
      events.push("auth");
      if (authUserId === null) {
        (res as unknown as FakeRes).status(401).json({ error: "Unauthorized" });
        return null;
      }
      return authUserId;
    },
    requireTeamWriteRole:
      options.gate ??
      (async (_userId, _teamId, res) => {
        events.push("gate");
        (res as unknown as FakeRes).status(403).json({ error: "Forbidden" });
        return null;
      }),
  };
  return {
    events,
    deps,
    registered,
    async invoke(index, req = {}) {
      const res = fakeRes();
      const next = vi.fn();
      const handler = registered[index].handlers[0] as (
        req: Request,
        res: Response,
        next: NextFunction,
      ) => void;
      handler(
        { body: {}, params: { id: "res-1" }, ...req } as Request,
        res as unknown as Response,
        next as unknown as NextFunction,
      );
      // The wrapper runs async work behind a synchronous handler: let it settle.
      await new Promise((resolve) => setImmediate(resolve));
      return { res, next };
    },
  };
}

const allowingGate =
  (events: Event[], role: TeamRoleName = "MEMBER") =>
  async (_userId: string, _teamId: string, _res: Response): Promise<TeamRoleName | null> => {
    events.push("gate");
    return role;
  };

function resolver(events: Event[], teamId: string | null = "team-1") {
  return async (_req: Request, res: Response) => {
    events.push("resolve");
    if (teamId === null) {
      (res as unknown as FakeRes).status(404).json({ error: "Widget not found" });
      return null;
    }
    return { teamId, input: "parsed" };
  };
}

describe("writeRoute registration", () => {
  it("registers exactly one Express handler per route: there is no middleware slot before the gate", () => {
    const h = harness();
    const writeRoute = createWriteRoute(h.deps);
    writeRoute("post", "/widgets", resolver(h.events), async () => {});
    expect(h.registered).toHaveLength(1);
    expect(h.registered[0].method).toBe("post");
    expect(h.registered[0].path).toBe("/widgets");
    expect(h.registered[0].handlers).toHaveLength(1);
    expect(typeof h.registered[0].handlers[0]).toBe("function");
  });

  it.each(["post", "put", "patch", "delete"] as const)(
    "registers %s on the router it was bound to",
    (method) => {
      const h = harness();
      createWriteRoute(h.deps)(method, "/w", resolver(h.events), async () => {});
      expect(h.registered.map((r) => r.method)).toEqual([method]);
    },
  );
});

describe("writeRoute order: auth, then team resolution, then the write gate, then the handler", () => {
  it("runs the four steps in that order and hands the handler the resolved context", async () => {
    const h = harness();
    h.deps.requireTeamWriteRole = async (userId, teamId, res) => {
      h.events.push(`gate:${userId}:${teamId}`);
      expect(res).toBeDefined();
      return "ADMIN";
    };
    const seen: unknown[] = [];
    createWriteRoute(h.deps)("post", "/w", resolver(h.events), async (ctx) => {
      h.events.push("handler");
      seen.push({ userId: ctx.userId, teamId: ctx.teamId, role: ctx.role, input: ctx.input });
    });
    await h.invoke(0);
    expect(h.events).toEqual(["auth", "resolve", "gate:user-1:team-1", "handler"]);
    expect(seen).toEqual([{ userId: "user-1", teamId: "team-1", role: "ADMIN", input: "parsed" }]);
  });

  it("an unauthenticated caller gets 401 and neither the resolver, the gate nor the handler runs", async () => {
    const h = harness({ authUserId: null });
    const handler = vi.fn();
    createWriteRoute(h.deps)("post", "/w", resolver(h.events), handler);
    const { res, next } = await h.invoke(0);
    expect(res.statusCode).toBe(401);
    expect(h.events).toEqual(["auth"]);
    expect(handler).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  it("a resolver that answers 404 or 400 stops before the gate and the handler", async () => {
    const h = harness();
    const handler = vi.fn();
    createWriteRoute(h.deps)("delete", "/w/:id", resolver(h.events, null), handler);
    const { res, next } = await h.invoke(0);
    expect(res.statusCode).toBe(404);
    expect(h.events).toEqual(["auth", "resolve"]);
    expect(handler).not.toHaveBeenCalled();
    // Answering is the end of the request: nothing falls through to the error path.
    expect(next).not.toHaveBeenCalled();
  });

  it("a denied write gate (403) stops before the handler: nothing of the handler runs", async () => {
    const h = harness();
    const handler = vi.fn();
    createWriteRoute(h.deps)("post", "/w", resolver(h.events), handler);
    const { res } = await h.invoke(0);
    expect(res.statusCode).toBe(403);
    expect(res.body).toEqual({ error: "Forbidden" });
    expect(h.events).toEqual(["auth", "resolve", "gate"]);
    expect(handler).not.toHaveBeenCalled();
  });

  it("the gate decides on the team the resolver returned, not on anything the request claims", async () => {
    const h = harness();
    const gate = vi.fn(allowingGate(h.events));
    h.deps.requireTeamWriteRole = gate;
    createWriteRoute(h.deps)("post", "/w", resolver(h.events, "team-from-resource"), async () => {});
    await h.invoke(0, { body: { teamId: "team-from-body" } });
    expect(gate.mock.calls[0].slice(0, 2)).toEqual(["user-1", "team-from-resource"]);
  });
});

describe("a handler cannot run before the gate (route-author shapes)", () => {
  // Each shape puts a side effect where a route author could try to run code
  // ahead of the write gate: the handler's parameter default, a tagged
  // template, a `new` expression, the first statement. All of them are part of
  // the handler, which the wrapper only calls after the gate, so for a denied
  // caller none of them executes.
  function tag(effects: string[]) {
    return (strings: TemplateStringsArray) => {
      effects.push(`tagged:${strings[0]}`);
      return strings[0];
    };
  }

  it("S2: a default-parameter initializer does not run for a denied caller", async () => {
    const h = harness();
    const effects: string[] = [];
    createWriteRoute(h.deps)(
      "post",
      "/w",
      resolver(h.events),
      async (ctx, sideEffect = effects.push("default")) => {
        void ctx;
        void sideEffect;
      },
    );
    const { res } = await h.invoke(0);
    expect(res.statusCode).toBe(403);
    expect(effects).toEqual([]);
  });

  it("S2: a default initializer inside the destructured context does not run for a denied caller", async () => {
    const h = harness();
    const effects: string[] = [];
    createWriteRoute(h.deps)(
      "post",
      "/w",
      resolver(h.events),
      async ({ res = (effects.push("destructuring default"), undefined as never) }) => {
        void res;
      },
    );
    await h.invoke(0);
    expect(effects).toEqual([]);
  });

  it("S3: a tagged template and a new expression in the handler do not run for a denied caller", async () => {
    const h = harness();
    const effects: string[] = [];
    const t = tag(effects);
    class Sender {
      constructor() {
        effects.push("new");
      }
    }
    createWriteRoute(h.deps)("post", "/w", resolver(h.events), async () => {
      t`before the gate`;
      new Sender();
    });
    await h.invoke(0);
    expect(effects).toEqual([]);
  });

  it("the same handler does run once the gate allows the caller (positive control)", async () => {
    const h = harness();
    h.deps.requireTeamWriteRole = allowingGate(h.events);
    const effects: string[] = [];
    const t = tag(effects);
    createWriteRoute(h.deps)("post", "/w", resolver(h.events), async () => {
      t`after the gate`;
    });
    await h.invoke(0);
    expect(effects).toEqual(["tagged:after the gate"]);
  });

  it("S0: the gate is called with the resolved team only; a route cannot add arguments or work to it", async () => {
    const h = harness();
    const gate = vi.fn(allowingGate(h.events));
    h.deps.requireTeamWriteRole = gate;
    createWriteRoute(h.deps)("post", "/w", resolver(h.events), async () => {});
    await h.invoke(0);
    expect(gate).toHaveBeenCalledTimes(1);
    expect(gate.mock.calls[0]).toHaveLength(3);
  });
});

describe("writeRoute error handling", () => {
  it("passes an error thrown by the handler to next (asyncHandler parity), after the gate allowed it", async () => {
    const h = harness();
    h.deps.requireTeamWriteRole = allowingGate(h.events);
    const boom = new Error("boom");
    createWriteRoute(h.deps)("post", "/w", resolver(h.events), async () => {
      throw boom;
    });
    const { next } = await h.invoke(0);
    expect(next).toHaveBeenCalledWith(boom);
  });

  it("passes an error thrown by the resolver or the gate to next without running the handler", async () => {
    const handler = vi.fn();

    const a = harness();
    const resolverError = new Error("lookup failed");
    createWriteRoute(a.deps)(
      "post",
      "/w",
      async () => {
        throw resolverError;
      },
      handler,
    );
    expect((await a.invoke(0)).next).toHaveBeenCalledWith(resolverError);

    const b = harness();
    const gateError = new Error("db down");
    b.deps.requireTeamWriteRole = async () => {
      throw gateError;
    };
    createWriteRoute(b.deps)("post", "/w", resolver(b.events), handler);
    expect((await b.invoke(0)).next).toHaveBeenCalledWith(gateError);

    expect(handler).not.toHaveBeenCalled();
  });
});

describe("teamFromBody", () => {
  const schema = z.object({ teamId: z.string().min(1), name: z.string() });

  it("takes the team from the validated body and passes the body on as input", async () => {
    const result = await teamFromBody(schema)(
      { body: { teamId: "t1", name: "n" } } as Request,
      fakeRes() as unknown as Response,
    );
    expect(result).toEqual({ teamId: "t1", input: { teamId: "t1", name: "n" } });
  });

  it("answers 400 with the flattened Zod error for an invalid body and returns null", async () => {
    const res = fakeRes();
    const result = await teamFromBody(schema)({ body: { name: 1 } } as Request, res as unknown as Response);
    expect(result).toBeNull();
    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: expect.objectContaining({ fieldErrors: expect.any(Object) }) });
  });
});

describe("teamFromResource", () => {
  const schema = z.object({ minutes: z.number() });

  it("loads the resource named by :id and returns its team; input is undefined without a schema", async () => {
    const load = vi.fn(async () => "team-9");
    const result = await teamFromResource(load, "Widget not found")(
      { params: { id: 42 } } as unknown as Request,
      fakeRes() as unknown as Response,
    );
    expect(load).toHaveBeenCalledWith("42");
    expect(result).toEqual({ teamId: "team-9", input: undefined });
  });

  it("answers 404 with the given message when the resource does not exist", async () => {
    const res = fakeRes();
    const result = await teamFromResource(async () => null, "Widget not found")(
      { params: { id: "x" } } as unknown as Request,
      res as unknown as Response,
    );
    expect(result).toBeNull();
    expect(res.statusCode).toBe(404);
    expect(res.body).toEqual({ error: "Widget not found" });
  });

  it("with a schema, validates the body first (400, resource not loaded) and passes it on as input", async () => {
    const load = vi.fn(async () => "team-9");
    const bad = fakeRes();
    expect(
      await teamFromResource(
        load,
        "nf",
        schema,
      )({ params: { id: "x" }, body: { minutes: "a" } } as unknown as Request, bad as unknown as Response),
    ).toBeNull();
    expect(bad.statusCode).toBe(400);
    expect(load).not.toHaveBeenCalled();

    const ok = await teamFromResource(
      load,
      "nf",
      schema,
    )({ params: { id: "x" }, body: { minutes: 5 } } as unknown as Request, fakeRes() as unknown as Response);
    expect(ok).toEqual({ teamId: "team-9", input: { minutes: 5 } });
  });
});

describe("writeRoute on a real Express router (status codes end to end)", () => {
  function app(role: TeamRoleName | null, loadTeamId: (id: string) => Promise<string | null>) {
    const router = Router();
    const writeRoute = createWriteRoute({
      router,
      requireAuth: async (req, res) => {
        if (req.header("authorization") !== "Bearer ok") {
          res.status(401).json({ error: "Unauthorized" });
          return null;
        }
        return "user-1";
      },
      requireTeamWriteRole: async (_userId, _teamId, res) => {
        if (role === null) {
          res.status(403).json({ error: "Forbidden" });
          return null;
        }
        return role;
      },
    });
    const mutations: string[] = [];
    writeRoute(
      "delete",
      "/widgets/:id",
      teamFromResource(loadTeamId, "Widget not found"),
      async ({ res, teamId }) => {
        mutations.push(teamId);
        res.status(204).end();
      },
    );
    writeRoute("post", "/widgets", teamFromBody(z.object({ teamId: z.string() })), async ({ res, input }) => {
      mutations.push(input.teamId);
      res.status(201).json({ ok: true });
    });
    const server = express();
    server.use(express.json());
    server.use(router);
    return { server, mutations };
  }

  it("401 without a token, 404 for an unknown resource, 403 for a denied role, 204/201 for a writer", async () => {
    const found = app("MEMBER", async () => "team-1");
    expect((await supertest(found.server).delete("/widgets/w1")).status).toBe(401);
    expect(
      (await supertest(found.server).delete("/widgets/w1").set("authorization", "Bearer ok")).status,
    ).toBe(204);
    expect(
      (await supertest(found.server).post("/widgets").set("authorization", "Bearer ok").send({})).status,
    ).toBe(400);
    expect(
      (await supertest(found.server).post("/widgets").set("authorization", "Bearer ok").send({ teamId: "t" }))
        .status,
    ).toBe(201);
    expect(found.mutations).toEqual(["team-1", "t"]);

    const missing = app("MEMBER", async () => null);
    expect(
      (await supertest(missing.server).delete("/widgets/w1").set("authorization", "Bearer ok")).status,
    ).toBe(404);

    const viewer = app(null, async () => "team-1");
    expect(
      (await supertest(viewer.server).delete("/widgets/w1").set("authorization", "Bearer ok")).status,
    ).toBe(403);
    expect(
      (
        await supertest(viewer.server)
          .post("/widgets")
          .set("authorization", "Bearer ok")
          .send({ teamId: "t" })
      ).status,
    ).toBe(403);
    expect(viewer.mutations).toEqual([]);
  });
});
