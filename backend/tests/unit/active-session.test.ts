import { beforeEach, describe, expect, it, vi } from "vitest";

const { findUnique } = vi.hoisted(() => ({ findUnique: vi.fn() }));

vi.mock("../../src/repositories/prisma.js", () => ({
  prisma: { session: { findUnique } },
}));

import { findActiveSession } from "../../src/services/team/active-session.js";

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
