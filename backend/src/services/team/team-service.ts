import type {
  AuthResult,
  LogSource,
  RegistrationResult,
  Team,
  TeamInvite,
  TeamWithRole,
  User,
} from "../../types/domain.js";
import { config } from "../../config/index.js";
import { prisma } from "../../repositories/prisma.js";
import { generateId } from "../../utils/id.js";
import { hashPassword, verifyPassword } from "../../utils/password.js";
import { createChildLogger } from "../../logger.js";

const log = createChildLogger("team-service");

function sanitizeUser(user: {
  id: string;
  email: string;
  name: string;
  role: string;
  status: string;
  createdAt: Date;
}): Omit<User, "passwordHash"> {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role as User["role"],
    status: user.status as User["status"],
    createdAt: user.createdAt.toISOString(),
  };
}

/** Keys shorter than this are hinted as `****` only: prefix plus tail would leave too little hidden. */
const MIN_PARTIALLY_HINTED_LENGTH = 12;

/** Upper bound on the visible prefix, so a long prefix cannot expose the key. */
const MAX_HINT_PREFIX_LENGTH = 8;

/**
 * The display hint for an ingest key: the prefix through the first underscore
 * (at most 8 characters), then `****`, then the last four characters (for a
 * generated key `lf_****a7c1`). A key shorter than 12 characters, including
 * the empty string, becomes `****`; a key without an underscore has no prefix
 * (`****a7c1`). The hint is all a list response carries of a key; the full
 * key leaves the server only through create, rotate and the audited reveal.
 */
export function sourceKeyHint(apiKey: string): string {
  if (apiKey.length < MIN_PARTIALLY_HINTED_LENGTH) return "****";
  const underscore = apiKey.indexOf("_");
  const prefix = underscore >= 0 ? apiKey.slice(0, Math.min(underscore + 1, MAX_HINT_PREFIX_LENGTH)) : "";
  return `${prefix}****${apiKey.slice(-4)}`;
}

// What a source response carries of the ingest key: nothing (MEMBER, VIEWER),
// the masked hint (OWNER and ADMIN lists and renames) or the full key (create
// and rotate, once). The field is omitted rather than masked when nothing is
// shown, so a response for a read-only or ordinary member has neither
// `apiKey` nor `keyHint`.
export type SourceKeyView = "none" | "hint" | "full";

// Maps a logSource row to the API shape.
function toLogSource(
  s: {
    id: string;
    teamId: string;
    name: string;
    type: string;
    config: unknown;
    retentionDays: number;
    createdAt: Date;
    apiKey: string;
  },
  keyView: SourceKeyView,
): LogSource {
  return {
    id: s.id,
    teamId: s.teamId,
    name: s.name,
    type: s.type as LogSource["type"],
    config: s.config as Record<string, unknown>,
    retentionDays: s.retentionDays,
    createdAt: s.createdAt.toISOString(),
    ...(keyView === "full" ? { apiKey: s.apiKey } : {}),
    ...(keyView === "hint" ? { keyHint: sourceKeyHint(s.apiKey) } : {}),
  };
}

function generateSourceApiKey(): string {
  return `lf_${generateId().replace(/-/g, "").slice(0, 24)}`;
}

export class TeamService {
  async register(email: string, password: string, name: string): Promise<RegistrationResult> {
    const normalizedEmail = email.trim().toLowerCase();
    const existing = await prisma.user.findUnique({ where: { email: normalizedEmail } });
    if (existing) {
      throw new Error("User already exists");
    }

    const isBootstrapAdmin =
      config.adminEmail !== undefined && normalizedEmail === config.adminEmail.trim().toLowerCase();

    if (config.registrationMode === "invite-only" && !isBootstrapAdmin) {
      throw new Error("Registration is currently invite-only");
    }

    const status: User["status"] =
      config.registrationMode === "approval" && !isBootstrapAdmin ? "PENDING" : "ACTIVE";
    const role: User["role"] = isBootstrapAdmin ? "ADMIN" : "USER";

    const user = await prisma.user.create({
      data: {
        email: normalizedEmail,
        passwordHash: await hashPassword(password),
        name,
        role,
        status,
      },
    });

    if (!config.multiTenant && status === "ACTIVE") {
      await this.addUserToDefaultTeam(user.id, role === "ADMIN" ? "OWNER" : "MEMBER");
    }

    log.info({ userId: user.id, email: normalizedEmail, status, role }, "User registered");

    if (status === "PENDING") {
      return {
        status: "pending_approval",
        message: "Your account has been created and is waiting for admin approval.",
        user: sanitizeUser(user),
      };
    }

    return this.createSession(user);
  }

  async login(email: string, password: string): Promise<AuthResult> {
    const normalizedEmail = email.trim().toLowerCase();
    const user = await prisma.user.findUnique({ where: { email: normalizedEmail } });
    if (!user) {
      throw new Error("Invalid credentials");
    }

    if (user.status === "PENDING") {
      throw new Error("Your account is pending admin approval");
    }
    if (user.status === "DISABLED") {
      throw new Error("Your account has been disabled");
    }

    const valid = await verifyPassword(password, user.passwordHash);
    if (!valid) {
      throw new Error("Invalid credentials");
    }

    log.info({ userId: user.id }, "User logged in");
    return this.createSession(user);
  }

  async listTeamsForUser(userId: string): Promise<TeamWithRole[]> {
    const memberships = await prisma.teamMember.findMany({
      where: { userId },
      include: { team: true },
    });
    return memberships.map((m) => ({
      id: m.team.id,
      name: m.team.name,
      slug: m.team.slug,
      createdAt: m.team.createdAt.toISOString(),
      role: m.role,
    }));
  }

  async createTeam(token: string, name: string, slug: string): Promise<Team> {
    if (!config.multiTenant) {
      throw new Error("Team creation is disabled in single-tenant mode");
    }
    const session = await this.validateToken(token);
    const team = await prisma.team.create({
      data: {
        name,
        slug,
        members: {
          create: { userId: session.userId, role: "OWNER" },
        },
      },
    });
    log.info({ teamId: team.id, slug }, "Team created");
    return {
      id: team.id,
      name: team.name,
      slug: team.slug,
      createdAt: team.createdAt.toISOString(),
    };
  }

  async listSources(teamId: string, options: { keyView: SourceKeyView }): Promise<LogSource[]> {
    const sources = await prisma.logSource.findMany({ where: { teamId } });
    return sources.map((s) => toLogSource(s, options.keyView));
  }

  // Renames a source. The update is scoped by id AND team so a caller can never
  // reach another team's source through a guessed id; a missing row surfaces as
  // Prisma's P2025 for the route to map to 404.
  async renameSource(
    teamId: string,
    sourceId: string,
    name: string,
    options: { keyView: SourceKeyView },
  ): Promise<LogSource> {
    const source = await prisma.logSource.update({
      where: { id: sourceId, teamId },
      data: { name },
    });
    log.info({ sourceId, teamId }, "Source renamed");
    return toLogSource(source, options.keyView);
  }

  // The create response is the one place a writer who may not reveal keys (a
  // MEMBER) sees the new source's key, once, so it can start sending logs.
  async createSource(teamId: string, name: string, type: LogSource["type"]): Promise<LogSource> {
    const apiKey = generateSourceApiKey();
    const source = await prisma.logSource.create({
      data: { teamId, name, type, config: {}, retentionDays: 7, apiKey },
    });
    log.info({ sourceId: source.id, teamId }, "Source created");
    return toLogSource(source, "full");
  }

  // Deletes the source row and nothing else. Ingest authenticates by looking
  // the key up on this table, so the key stops working at once. Logs already
  // stored in ClickHouse are not touched; they age out with the table TTL. The
  // delete is scoped by id AND team (a missing row surfaces as Prisma's P2025
  // for the route to map to 404).
  async deleteSource(teamId: string, sourceId: string): Promise<void> {
    await prisma.logSource.delete({ where: { id: sourceId, teamId } });
    log.info({ sourceId, teamId }, "Source deleted");
  }

  // Replaces the source's ingest key in place (hard cutover: the old key is
  // rejected by the next ingest request, no grace window). The returned source
  // carries the new key; the route sends it once and no list returns it, only
  // the hint.
  async rotateSourceKey(teamId: string, sourceId: string): Promise<LogSource> {
    const source = await prisma.logSource.update({
      where: { id: sourceId, teamId },
      data: { apiKey: generateSourceApiKey() },
    });
    log.info({ sourceId, teamId }, "Source key rotated");
    return toLogSource(source, "full");
  }

  // Reads one source's full ingest key for the audited reveal route. Scoped by
  // id AND team so a guessed id of another team's source yields null (the route
  // maps it to 404). The caller decides who may ask; this method does not log.
  async revealSourceKey(teamId: string, sourceId: string): Promise<string | null> {
    const source = await prisma.logSource.findUnique({
      where: { id: sourceId, teamId },
      select: { apiKey: true },
    });
    return source?.apiKey ?? null;
  }

  async findSourceById(sourceId: string) {
    return prisma.logSource.findUnique({ where: { id: sourceId } });
  }

  // --- Single-Tenant Support ---

  async ensureDefaultTeam(): Promise<{ id: string; name: string; slug: string }> {
    const existing = await prisma.team.findUnique({ where: { slug: "default" } });
    if (existing) return existing;
    const team = await prisma.team.create({
      data: { name: "Default", slug: "default" },
    });
    log.info({ teamId: team.id }, "Default team created (single-tenant mode)");
    return team;
  }

  async getMemberCount(teamId: string): Promise<number> {
    return prisma.teamMember.count({ where: { teamId } });
  }

  async approveUser(userId: string) {
    const user = await prisma.user.update({
      where: { id: userId },
      data: { status: "ACTIVE" },
      select: { id: true, email: true, name: true, role: true, status: true, createdAt: true },
    });

    if (!config.multiTenant) {
      const membership = await prisma.teamMember.findFirst({ where: { userId } });
      if (!membership) {
        await this.addUserToDefaultTeam(userId, user.role === "ADMIN" ? "OWNER" : "MEMBER");
      }
    }

    log.info({ userId }, "User approved");
    return sanitizeUser(user);
  }

  async addUserToTeam(userId: string, teamId: string, role: "OWNER" | "ADMIN" | "MEMBER" | "VIEWER") {
    const membership = await prisma.teamMember.findUnique({
      where: { teamId_userId: { teamId, userId } },
    });

    if (membership) {
      return prisma.teamMember.update({
        where: { teamId_userId: { teamId, userId } },
        data: { role },
      });
    }

    return prisma.teamMember.create({
      data: { userId, teamId, role },
    });
  }

  async removeUserFromTeam(userId: string, teamId: string): Promise<void> {
    await prisma.teamMember.delete({
      where: { teamId_userId: { teamId, userId } },
    });
  }

  // --- Invite System (Multi-Tenant) ---

  async createInvite(
    teamId: string,
    createdByUserId: string,
    role: "ADMIN" | "MEMBER" | "VIEWER" = "MEMBER",
    email?: string,
  ): Promise<TeamInvite> {
    if (!config.multiTenant) {
      throw new Error("Invites are disabled in single-tenant mode");
    }
    const token = `inv_${generateId().replace(/-/g, "").slice(0, 24)}`;
    const invite = await prisma.teamInvite.create({
      data: {
        teamId,
        email: email ?? null,
        token,
        role,
        createdBy: createdByUserId,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
      },
    });
    log.info({ teamId, inviteId: invite.id }, "Invite created");
    return this.mapInvite(invite);
  }

  async acceptInvite(inviteToken: string, userId: string): Promise<Team> {
    const invite = await prisma.teamInvite.findUnique({ where: { token: inviteToken } });
    if (!invite) throw new Error("Invalid invite token");
    if (invite.usedAt) throw new Error("Invite already used");
    if (invite.expiresAt < new Date()) throw new Error("Invite expired");
    if (invite.email) {
      const user = await prisma.user.findUnique({ where: { id: userId } });
      if (user?.email !== invite.email) throw new Error("Invite is for a different email");
    }

    // Check if user is already a member
    const existing = await prisma.teamMember.findUnique({
      where: { teamId_userId: { teamId: invite.teamId, userId } },
    });
    if (existing) throw new Error("Already a member of this team");

    await prisma.$transaction([
      prisma.teamMember.create({
        data: { teamId: invite.teamId, userId, role: invite.role },
      }),
      prisma.teamInvite.update({
        where: { id: invite.id },
        data: { usedAt: new Date() },
      }),
    ]);

    const team = await prisma.team.findUniqueOrThrow({ where: { id: invite.teamId } });
    log.info({ teamId: invite.teamId, userId }, "Invite accepted");
    return {
      id: team.id,
      name: team.name,
      slug: team.slug,
      createdAt: team.createdAt.toISOString(),
    };
  }

  async listInvites(teamId: string): Promise<TeamInvite[]> {
    const invites = await prisma.teamInvite.findMany({
      where: { teamId, usedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: "desc" },
    });
    return invites.map((i) => this.mapInvite(i));
  }

  // teamId is a required scope, not a hint: the delete must never match an
  // invite outside the caller's already-authorized team (defence in depth
  // under the router's role check).
  async revokeInvite(inviteId: string, teamId: string): Promise<void> {
    const result = await prisma.teamInvite.deleteMany({ where: { id: inviteId, teamId } });
    if (result.count === 0) {
      throw new Error("Invite not found");
    }
    log.info({ inviteId, teamId }, "Invite revoked");
  }

  private mapInvite(invite: {
    id: string;
    teamId: string;
    email: string | null;
    token: string;
    role: string;
    createdBy: string;
    expiresAt: Date;
    usedAt: Date | null;
    createdAt: Date;
  }): TeamInvite {
    return {
      id: invite.id,
      teamId: invite.teamId,
      email: invite.email,
      token: invite.token,
      role: invite.role as TeamInvite["role"],
      createdBy: invite.createdBy,
      expiresAt: invite.expiresAt.toISOString(),
      usedAt: invite.usedAt?.toISOString() ?? null,
      createdAt: invite.createdAt.toISOString(),
    };
  }

  private async validateToken(token: string) {
    const session = await prisma.session.findUnique({ where: { token } });
    if (!session || session.expiresAt < new Date()) {
      throw new Error("Unauthorized");
    }
    return session;
  }

  private async createSession(user: {
    id: string;
    email: string;
    name: string;
    role: string;
    status: string;
    createdAt: Date;
  }): Promise<AuthResult> {
    const token = `sess_${generateId().replace(/-/g, "").slice(0, 24)}`;
    await prisma.session.create({
      data: {
        userId: user.id,
        token,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });
    return { token, user: sanitizeUser(user) };
  }

  private async addUserToDefaultTeam(userId: string, role: "OWNER" | "ADMIN" | "MEMBER" | "VIEWER") {
    const defaultTeam = await this.ensureDefaultTeam();
    await prisma.teamMember.upsert({
      where: { teamId_userId: { teamId: defaultTeam.id, userId } },
      create: { teamId: defaultTeam.id, userId, role },
      update: { role },
    });
    log.info({ userId, teamId: defaultTeam.id }, "User assigned to default team");
  }
}
