import { beforeEach, describe, expect, it, vi } from "vitest";

const { findUnique, memberFindUnique } = vi.hoisted(() => ({ findUnique: vi.fn(), memberFindUnique: vi.fn() }));

vi.mock("../../src/repositories/prisma.js", () => ({
  prisma: { session: { findUnique }, teamMember: { findUnique: memberFindUnique } },
}));

import {
  findActiveSession,
  findActiveSessionById,
  isSessionAuthorizedForTeam,
  isSessionIdAuthorizedForTeam,
} from "../../src/services/team/active-session.js";

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: "s1",
    userId: "u1",
    token: "sess_a",
    expiresAt: new Date(Date.now() + 60_000),
    user: { status: "ACTIVE" },
    ...overrides,
  };
}

describe("findActiveSession", () => {
  beforeEach(() => {
    findUnique.mockReset();
  });

  it("looks the token up together with the user's status", async () => {
    findUnique.mockResolvedValue(row());

    await findActiveSession("sess_a");

    expect(findUnique).toHaveBeenCalledExactlyOnceWith({
      where: { token: "sess_a" },
      include: { user: { select: { status: true } } },
    });
  });

  it("returns the session of an ACTIVE user whose token has not expired", async () => {
    const live = row();
    findUnique.mockResolvedValue(live);

    await expect(findActiveSession("sess_a")).resolves.toBe(live);
  });

  it("returns null for an unknown token", async () => {
    findUnique.mockResolvedValue(null);

    await expect(findActiveSession("nope")).resolves.toBeNull();
  });

  it("returns null for an expired token of an ACTIVE user", async () => {
    findUnique.mockResolvedValue(row({ expiresAt: new Date(Date.now() - 1000) }));

    await expect(findActiveSession("sess_a")).resolves.toBeNull();
  });

  it("returns null for an unexpired token whose user is DISABLED", async () => {
    findUnique.mockResolvedValue(row({ user: { status: "DISABLED" } }));

    await expect(findActiveSession("sess_a")).resolves.toBeNull();
  });

  it("returns null for an unexpired token whose user is PENDING", async () => {
    findUnique.mockResolvedValue(row({ user: { status: "PENDING" } }));

    await expect(findActiveSession("sess_a")).resolves.toBeNull();
  });

  it("returns null for an expired token of a DISABLED user (both reasons agree)", async () => {
    findUnique.mockResolvedValue(
      row({ expiresAt: new Date(Date.now() - 1000), user: { status: "DISABLED" } }),
    );

    await expect(findActiveSession("sess_a")).resolves.toBeNull();
  });
});

describe("isSessionAuthorizedForTeam", () => {
  beforeEach(() => {
    findUnique.mockReset();
    memberFindUnique.mockReset();
  });

  it("is true for a live session of the same user who is still a member of the team", async () => {
    findUnique.mockResolvedValue(row());
    memberFindUnique.mockResolvedValue({ id: "tm" });

    await expect(isSessionAuthorizedForTeam("sess_a", "u1", "t1")).resolves.toBe(true);
    expect(memberFindUnique).toHaveBeenCalledExactlyOnceWith({
      where: { teamId_userId: { teamId: "t1", userId: "u1" } },
    });
  });

  it("is false once the user is DISABLED, without a membership lookup", async () => {
    findUnique.mockResolvedValue(row({ user: { status: "DISABLED" } }));
    memberFindUnique.mockResolvedValue({ id: "tm" });

    await expect(isSessionAuthorizedForTeam("sess_a", "u1", "t1")).resolves.toBe(false);
    expect(memberFindUnique).not.toHaveBeenCalled();
  });

  it("is false once the session is gone", async () => {
    findUnique.mockResolvedValue(null);

    await expect(isSessionAuthorizedForTeam("sess_a", "u1", "t1")).resolves.toBe(false);
  });

  it("is false when the token now belongs to another user", async () => {
    findUnique.mockResolvedValue(row({ userId: "u2" }));
    memberFindUnique.mockResolvedValue({ id: "tm" });

    await expect(isSessionAuthorizedForTeam("sess_a", "u1", "t1")).resolves.toBe(false);
  });

  it("is false once the user is no longer a member of the team", async () => {
    findUnique.mockResolvedValue(row());
    memberFindUnique.mockResolvedValue(null);

    await expect(isSessionAuthorizedForTeam("sess_a", "u1", "t1")).resolves.toBe(false);
  });

  it("rejects, rather than answering false, when the lookup fails", async () => {
    findUnique.mockResolvedValue(row());
    memberFindUnique.mockRejectedValue(new Error("db down"));

    await expect(isSessionAuthorizedForTeam("sess_a", "u1", "t1")).rejects.toThrow("db down");
  });
});

// The same rules for a caller that holds the session id (a stream opened with a
// ticket): the row is found by id and judged exactly like one found by token.
describe("findActiveSessionById", () => {
  beforeEach(() => {
    findUnique.mockReset();
  });

  it("looks the row up by id together with the user's status", async () => {
    findUnique.mockResolvedValue(row());

    await findActiveSessionById("s1");

    expect(findUnique).toHaveBeenCalledExactlyOnceWith({
      where: { id: "s1" },
      include: { user: { select: { status: true } } },
    });
  });

  it("returns the session of an ACTIVE user whose session has not expired", async () => {
    const live = row();
    findUnique.mockResolvedValue(live);

    await expect(findActiveSessionById("s1")).resolves.toBe(live);
  });

  it("returns null for an unknown id", async () => {
    findUnique.mockResolvedValue(null);

    await expect(findActiveSessionById("nope")).resolves.toBeNull();
  });

  it("returns null for an expired session of an ACTIVE user", async () => {
    findUnique.mockResolvedValue(row({ expiresAt: new Date(Date.now() - 1000) }));

    await expect(findActiveSessionById("s1")).resolves.toBeNull();
  });

  it.each(["DISABLED", "PENDING"])("returns null for an unexpired session whose user is %s", async (status) => {
    findUnique.mockResolvedValue(row({ user: { status } }));

    await expect(findActiveSessionById("s1")).resolves.toBeNull();
  });
});

describe("isSessionIdAuthorizedForTeam", () => {
  beforeEach(() => {
    findUnique.mockReset();
    memberFindUnique.mockReset();
  });

  it("is true for a live session of the same user who is still a member of the team", async () => {
    findUnique.mockResolvedValue(row());
    memberFindUnique.mockResolvedValue({ id: "tm" });

    await expect(isSessionIdAuthorizedForTeam("s1", "u1", "t1")).resolves.toBe(true);
    expect(findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "s1" } }));
    expect(memberFindUnique).toHaveBeenCalledExactlyOnceWith({
      where: { teamId_userId: { teamId: "t1", userId: "u1" } },
    });
  });

  it("is false once the user is DISABLED, without a membership lookup", async () => {
    findUnique.mockResolvedValue(row({ user: { status: "DISABLED" } }));

    await expect(isSessionIdAuthorizedForTeam("s1", "u1", "t1")).resolves.toBe(false);
    expect(memberFindUnique).not.toHaveBeenCalled();
  });

  it("is false once the session is gone", async () => {
    findUnique.mockResolvedValue(null);

    await expect(isSessionIdAuthorizedForTeam("s1", "u1", "t1")).resolves.toBe(false);
  });

  it("is false when the session now belongs to another user", async () => {
    findUnique.mockResolvedValue(row({ userId: "u2" }));
    memberFindUnique.mockResolvedValue({ id: "tm" });

    await expect(isSessionIdAuthorizedForTeam("s1", "u1", "t1")).resolves.toBe(false);
  });

  it("is false once the user is no longer a member of the team", async () => {
    findUnique.mockResolvedValue(row());
    memberFindUnique.mockResolvedValue(null);

    await expect(isSessionIdAuthorizedForTeam("s1", "u1", "t1")).resolves.toBe(false);
  });

  it("rejects, rather than answering false, when the lookup fails", async () => {
    findUnique.mockResolvedValue(row());
    memberFindUnique.mockRejectedValue(new Error("db down"));

    await expect(isSessionIdAuthorizedForTeam("s1", "u1", "t1")).rejects.toThrow("db down");
  });
});
