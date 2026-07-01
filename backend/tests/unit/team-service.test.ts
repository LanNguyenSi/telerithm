import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mocks — must appear before any import that resolves the mocked modules
// ---------------------------------------------------------------------------

const {
  mockTeamInviteCreate,
  mockTeamInviteFindUnique,
  mockTeamInviteUpdate,
  mockTeamInviteFindMany,
  mockTeamInviteDelete,
  mockTeamMemberFindUnique,
  mockTeamMemberCreate,
  mockTeamMemberDelete,
  mockTeamMemberFindFirst,
  mockTeamMemberUpsert,
  mockUserFindUnique,
  mockUserUpdate,
  mockTeamFindUnique,
  mockTeamCreate,
  mockTeamFindUniqueOrThrow,
  mockTransaction,
  configMock,
} = vi.hoisted(() => ({
  mockTeamInviteCreate: vi.fn(),
  mockTeamInviteFindUnique: vi.fn(),
  mockTeamInviteUpdate: vi.fn(),
  mockTeamInviteFindMany: vi.fn(),
  mockTeamInviteDelete: vi.fn(),
  mockTeamMemberFindUnique: vi.fn(),
  mockTeamMemberCreate: vi.fn(),
  mockTeamMemberDelete: vi.fn(),
  mockTeamMemberFindFirst: vi.fn(),
  mockTeamMemberUpsert: vi.fn(),
  mockUserFindUnique: vi.fn(),
  mockUserUpdate: vi.fn(),
  mockTeamFindUnique: vi.fn(),
  mockTeamCreate: vi.fn(),
  mockTeamFindUniqueOrThrow: vi.fn(),
  mockTransaction: vi.fn(),
  configMock: { multiTenant: true, registrationMode: "approval", adminEmail: undefined as string | undefined },
}));

vi.mock("../../src/config/index.js", () => ({
  config: configMock,
}));

vi.mock("../../src/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), fatal: vi.fn() },
  createChildLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

vi.mock("../../src/repositories/prisma.js", () => ({
  prisma: {
    teamInvite: {
      create: mockTeamInviteCreate,
      findUnique: mockTeamInviteFindUnique,
      update: mockTeamInviteUpdate,
      findMany: mockTeamInviteFindMany,
      delete: mockTeamInviteDelete,
    },
    teamMember: {
      findUnique: mockTeamMemberFindUnique,
      create: mockTeamMemberCreate,
      delete: mockTeamMemberDelete,
      findFirst: mockTeamMemberFindFirst,
      upsert: mockTeamMemberUpsert,
    },
    user: {
      findUnique: mockUserFindUnique,
      update: mockUserUpdate,
    },
    team: {
      findUnique: mockTeamFindUnique,
      create: mockTeamCreate,
      findUniqueOrThrow: mockTeamFindUniqueOrThrow,
    },
    $transaction: mockTransaction,
  },
}));

import { TeamService } from "../../src/services/team/team-service.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const TEAM_A = "team-aaa";
const TEAM_B = "team-bbb";
const USER_ID = "user-1";
const ACTOR_ID = "actor-1";

function makeInvite(overrides: Record<string, unknown> = {}) {
  return {
    id: "invite-1",
    teamId: TEAM_A,
    email: null,
    token: "inv_abcdef0123456789abcdef01",
    role: "MEMBER",
    createdBy: ACTOR_ID,
    expiresAt: new Date(Date.now() + 60_000),
    usedAt: null,
    createdAt: new Date("2024-01-15T10:00:00.000Z"),
    ...overrides,
  };
}

function makeUser(overrides: Record<string, unknown> = {}) {
  return {
    id: USER_ID,
    email: "u@example.com",
    name: "User One",
    role: "USER",
    status: "ACTIVE",
    createdAt: new Date("2024-01-15T10:00:00.000Z"),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// createInvite
// ---------------------------------------------------------------------------

describe("TeamService.createInvite", () => {
  let service: TeamService;

  beforeEach(() => {
    vi.clearAllMocks();
    configMock.multiTenant = true;
    service = new TeamService();
  });

  it("creates an invite scoped to the given teamId/creator/role/email", async () => {
    mockTeamInviteCreate.mockResolvedValue(makeInvite({ teamId: TEAM_A, email: "x@y.com", role: "ADMIN" }));

    const result = await service.createInvite(TEAM_A, ACTOR_ID, "ADMIN", "x@y.com");

    expect(mockTeamInviteCreate).toHaveBeenCalledWith({
      data: {
        teamId: TEAM_A,
        email: "x@y.com",
        token: expect.stringMatching(/^inv_[0-9a-f]{24}$/),
        role: "ADMIN",
        createdBy: ACTOR_ID,
        expiresAt: expect.any(Date),
      },
    });
    expect(result.teamId).toBe(TEAM_A);
    expect(result.role).toBe("ADMIN");
  });

  it("defaults role to MEMBER and email to null when omitted", async () => {
    mockTeamInviteCreate.mockResolvedValue(makeInvite());

    await service.createInvite(TEAM_A, ACTOR_ID);

    expect(mockTeamInviteCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ role: "MEMBER", email: null }),
      }),
    );
  });

  it("rejects invite creation in single-tenant mode regardless of team/role and never touches prisma", async () => {
    configMock.multiTenant = false;

    await expect(service.createInvite(TEAM_A, ACTOR_ID, "ADMIN")).rejects.toThrow(
      "Invites are disabled in single-tenant mode",
    );
    expect(mockTeamInviteCreate).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// acceptInvite
// ---------------------------------------------------------------------------

describe("TeamService.acceptInvite", () => {
  let service: TeamService;

  beforeEach(() => {
    vi.clearAllMocks();
    configMock.multiTenant = true;
    service = new TeamService();
    mockTransaction.mockImplementation(async (ops: Array<Promise<unknown>>) => Promise.all(ops));
  });

  it("looks up the invite by token, checks membership scoped to the invite's team, and creates a membership with the invite's role", async () => {
    const invite = makeInvite({ teamId: TEAM_A, role: "VIEWER" });
    mockTeamInviteFindUnique.mockResolvedValue(invite);
    mockTeamMemberFindUnique.mockResolvedValue(null);
    mockTeamMemberCreate.mockResolvedValue({ id: "tm-1" });
    mockTeamInviteUpdate.mockResolvedValue({ ...invite, usedAt: new Date() });
    mockTeamFindUniqueOrThrow.mockResolvedValue({
      id: TEAM_A,
      name: "Team A",
      slug: "team-a",
      createdAt: new Date("2024-01-15T10:00:00.000Z"),
    });

    const result = await service.acceptInvite(invite.token, USER_ID);

    expect(mockTeamInviteFindUnique).toHaveBeenCalledWith({ where: { token: invite.token } });
    expect(mockTeamMemberFindUnique).toHaveBeenCalledWith({
      where: { teamId_userId: { teamId: TEAM_A, userId: USER_ID } },
    });
    expect(mockTransaction).toHaveBeenCalledOnce();
    expect(mockTeamMemberCreate).toHaveBeenCalledWith({
      data: { teamId: TEAM_A, userId: USER_ID, role: "VIEWER" },
    });
    expect(mockTeamInviteUpdate).toHaveBeenCalledWith({
      where: { id: invite.id },
      data: { usedAt: expect.any(Date) },
    });
    expect(mockTeamFindUniqueOrThrow).toHaveBeenCalledWith({ where: { id: TEAM_A } });
    expect(result).toEqual({
      id: TEAM_A,
      name: "Team A",
      slug: "team-a",
      createdAt: "2024-01-15T10:00:00.000Z",
    });
  });

  it("rejects an invalid (unknown) token before touching membership state", async () => {
    mockTeamInviteFindUnique.mockResolvedValue(null);

    await expect(service.acceptInvite("bogus-token", USER_ID)).rejects.toThrow(
      "Invalid invite token",
    );
    expect(mockTeamMemberFindUnique).not.toHaveBeenCalled();
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it("rejects an already-used invite (usedAt set) and never creates a membership", async () => {
    // usedAt is checked before expiresAt in the source; a used-but-unexpired
    // invite must still be rejected. Guards against invite-token replay.
    const invite = makeInvite({ usedAt: new Date("2026-06-01T00:00:00.000Z") });
    mockTeamInviteFindUnique.mockResolvedValue(invite);

    await expect(service.acceptInvite(invite.token, USER_ID)).rejects.toThrow(
      "Invite already used",
    );
    expect(mockTeamMemberFindUnique).not.toHaveBeenCalled();
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it("rejects an expired invite and never creates a membership", async () => {
    const invite = makeInvite({ expiresAt: new Date(Date.now() - 1000) });
    mockTeamInviteFindUnique.mockResolvedValue(invite);

    await expect(service.acceptInvite(invite.token, USER_ID)).rejects.toThrow("Invite expired");
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it("rejects when the invite is email-restricted and the accepting user's email does not match (prevents token hijack by another user)", async () => {
    const invite = makeInvite({ email: "owner@team-a.com" });
    mockTeamInviteFindUnique.mockResolvedValue(invite);
    mockUserFindUnique.mockResolvedValue(makeUser({ id: USER_ID, email: "someone-else@x.com" }));

    await expect(service.acceptInvite(invite.token, USER_ID)).rejects.toThrow(
      "Invite is for a different email",
    );
    expect(mockUserFindUnique).toHaveBeenCalledWith({ where: { id: USER_ID } });
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it("rejects when the user is already a member of the invite's team, scoped to that exact team+user pair", async () => {
    const invite = makeInvite({ teamId: TEAM_A });
    mockTeamInviteFindUnique.mockResolvedValue(invite);
    mockTeamMemberFindUnique.mockResolvedValue({ id: "existing-membership" });

    await expect(service.acceptInvite(invite.token, USER_ID)).rejects.toThrow(
      "Already a member of this team",
    );
    expect(mockTeamMemberFindUnique).toHaveBeenCalledWith({
      where: { teamId_userId: { teamId: TEAM_A, userId: USER_ID } },
    });
    expect(mockTransaction).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// listInvites
// ---------------------------------------------------------------------------

describe("TeamService.listInvites", () => {
  let service: TeamService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new TeamService();
  });

  it("scopes the query to the given teamId and excludes used/expired invites", async () => {
    mockTeamInviteFindMany.mockResolvedValue([makeInvite({ teamId: TEAM_A })]);

    const result = await service.listInvites(TEAM_A);

    expect(mockTeamInviteFindMany).toHaveBeenCalledWith({
      where: { teamId: TEAM_A, usedAt: null, expiresAt: { gt: expect.any(Date) } },
      orderBy: { createdAt: "desc" },
    });
    expect(result).toHaveLength(1);
    expect(result[0].teamId).toBe(TEAM_A);
  });

  it("never leaks another team's invites — a different teamId produces a differently-scoped query", async () => {
    mockTeamInviteFindMany.mockResolvedValue([]);

    await service.listInvites(TEAM_B);

    expect(mockTeamInviteFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ teamId: TEAM_B }) }),
    );
  });

  it("returns an empty array when there are no active invites", async () => {
    mockTeamInviteFindMany.mockResolvedValue([]);

    const result = await service.listInvites(TEAM_A);

    expect(result).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// revokeInvite
// ---------------------------------------------------------------------------

describe("TeamService.revokeInvite", () => {
  let service: TeamService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new TeamService();
  });

  it("deletes exactly the given inviteId", async () => {
    mockTeamInviteDelete.mockResolvedValue({ id: "invite-1" });

    await service.revokeInvite("invite-1");

    expect(mockTeamInviteDelete).toHaveBeenCalledExactlyOnceWith({ where: { id: "invite-1" } });
  });

  it("propagates the error when the invite does not exist (already revoked / wrong id)", async () => {
    mockTeamInviteDelete.mockRejectedValue(new Error("Record to delete does not exist (P2025)"));

    await expect(service.revokeInvite("missing-invite")).rejects.toThrow("P2025");
  });
});

// ---------------------------------------------------------------------------
// removeUserFromTeam
// ---------------------------------------------------------------------------

describe("TeamService.removeUserFromTeam", () => {
  let service: TeamService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new TeamService();
  });

  it("deletes the membership scoped to the exact teamId_userId composite key", async () => {
    mockTeamMemberDelete.mockResolvedValue({ id: "tm-1" });

    await service.removeUserFromTeam(USER_ID, TEAM_A);

    expect(mockTeamMemberDelete).toHaveBeenCalledExactlyOnceWith({
      where: { teamId_userId: { teamId: TEAM_A, userId: USER_ID } },
    });
  });

  it("fails safely (no silent cross-team fallback) when the user is not a member of the given team", async () => {
    mockTeamMemberDelete.mockRejectedValue(new Error("Record to delete does not exist (P2025)"));

    await expect(service.removeUserFromTeam(USER_ID, TEAM_B)).rejects.toThrow("P2025");
    expect(mockTeamMemberDelete).toHaveBeenCalledExactlyOnceWith({
      where: { teamId_userId: { teamId: TEAM_B, userId: USER_ID } },
    });
  });
});

// ---------------------------------------------------------------------------
// approveUser
// ---------------------------------------------------------------------------

describe("TeamService.approveUser", () => {
  let service: TeamService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new TeamService();
  });

  it("activates the exact userId and auto-assigns a MEMBER role on the default team when single-tenant and unassigned", async () => {
    configMock.multiTenant = false;
    mockUserUpdate.mockResolvedValue(makeUser({ id: USER_ID, role: "USER", status: "ACTIVE" }));
    mockTeamMemberFindFirst.mockResolvedValue(null);
    mockTeamFindUnique.mockResolvedValue({ id: "default-team", name: "Default", slug: "default" });
    mockTeamMemberUpsert.mockResolvedValue({ id: "tm-new" });

    const result = await service.approveUser(USER_ID);

    expect(mockUserUpdate).toHaveBeenCalledWith({
      where: { id: USER_ID },
      data: { status: "ACTIVE" },
      select: { id: true, email: true, name: true, role: true, status: true, createdAt: true },
    });
    expect(mockTeamMemberFindFirst).toHaveBeenCalledWith({ where: { userId: USER_ID } });
    expect(mockTeamFindUnique).toHaveBeenCalledWith({ where: { slug: "default" } });
    expect(mockTeamMemberUpsert).toHaveBeenCalledWith({
      where: { teamId_userId: { teamId: "default-team", userId: USER_ID } },
      create: { teamId: "default-team", userId: USER_ID, role: "MEMBER" },
      update: { role: "MEMBER" },
    });
    expect(result.id).toBe(USER_ID);
    expect(result.status).toBe("ACTIVE");
  });

  it("assigns OWNER (not MEMBER) when the approved user's role is ADMIN", async () => {
    configMock.multiTenant = false;
    mockUserUpdate.mockResolvedValue(makeUser({ id: USER_ID, role: "ADMIN" }));
    mockTeamMemberFindFirst.mockResolvedValue(null);
    mockTeamFindUnique.mockResolvedValue({ id: "default-team", name: "Default", slug: "default" });
    mockTeamMemberUpsert.mockResolvedValue({ id: "tm-new" });

    await service.approveUser(USER_ID);

    expect(mockTeamMemberUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: { teamId: "default-team", userId: USER_ID, role: "OWNER" },
        update: { role: "OWNER" },
      }),
    );
  });

  it("does not touch team membership at all in multi-tenant mode (no automatic team grant)", async () => {
    configMock.multiTenant = true;
    mockUserUpdate.mockResolvedValue(makeUser({ id: USER_ID }));

    await service.approveUser(USER_ID);

    expect(mockTeamMemberFindFirst).not.toHaveBeenCalled();
    expect(mockTeamMemberUpsert).not.toHaveBeenCalled();
  });

  it("does not reassign role when the user already has a team membership in single-tenant mode", async () => {
    configMock.multiTenant = false;
    mockUserUpdate.mockResolvedValue(makeUser({ id: USER_ID }));
    mockTeamMemberFindFirst.mockResolvedValue({ id: "existing-tm", teamId: TEAM_A, userId: USER_ID, role: "MEMBER" });

    await service.approveUser(USER_ID);

    expect(mockTeamFindUnique).not.toHaveBeenCalled();
    expect(mockTeamMemberUpsert).not.toHaveBeenCalled();
  });
});
