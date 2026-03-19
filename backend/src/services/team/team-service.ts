import type { AuthResult, LogSource, Team, User } from "../../types/domain.js";
import { prisma } from "../../repositories/prisma.js";
import { generateId } from "../../utils/id.js";
import { hashPassword, verifyPassword } from "../../utils/password.js";
import { createChildLogger } from "../../logger.js";

const log = createChildLogger("team-service");

function sanitizeUser(user: { id: string; email: string; name: string; role: string; createdAt: Date }): Omit<User, "passwordHash"> {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role as User["role"],
    createdAt: user.createdAt.toISOString(),
  };
}

export class TeamService {
  async register(email: string, password: string, name: string): Promise<AuthResult> {
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      throw new Error("User already exists");
    }

    const user = await prisma.user.create({
      data: {
        email,
        passwordHash: await hashPassword(password),
        name,
        role: "USER",
      },
    });

    log.info({ userId: user.id, email }, "User registered");
    return this.createSession(user);
  }

  async login(email: string, password: string): Promise<AuthResult> {
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      throw new Error("Invalid credentials");
    }

    const valid = await verifyPassword(password, user.passwordHash);
    if (!valid) {
      throw new Error("Invalid credentials");
    }

    log.info({ userId: user.id }, "User logged in");
    return this.createSession(user);
  }

  async listTeamsForToken(token: string): Promise<Team[]> {
    const session = await this.validateToken(token);
    const memberships = await prisma.teamMember.findMany({
      where: { userId: session.userId },
      include: { team: true },
    });
    return memberships.map((m) => ({
      id: m.team.id,
      name: m.team.name,
      slug: m.team.slug,
      plan: m.team.plan as Team["plan"],
      createdAt: m.team.createdAt.toISOString(),
    }));
  }

  async createTeam(token: string, name: string, slug: string): Promise<Team> {
    const session = await this.validateToken(token);
    const team = await prisma.team.create({
      data: {
        name,
        slug,
        plan: "FREE",
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
      plan: team.plan as Team["plan"],
      createdAt: team.createdAt.toISOString(),
    };
  }

  async listSources(teamId: string): Promise<LogSource[]> {
    const sources = await prisma.logSource.findMany({ where: { teamId } });
    return sources.map((s) => ({
      id: s.id,
      teamId: s.teamId,
      name: s.name,
      type: s.type as LogSource["type"],
      config: s.config as Record<string, unknown>,
      retentionDays: s.retentionDays,
      createdAt: s.createdAt.toISOString(),
      apiKey: s.apiKey,
    }));
  }

  async createSource(teamId: string, name: string, type: LogSource["type"]): Promise<LogSource> {
    const apiKey = `lf_${generateId().replace(/-/g, "").slice(0, 24)}`;
    const source = await prisma.logSource.create({
      data: { teamId, name, type, config: {}, retentionDays: 7, apiKey },
    });
    log.info({ sourceId: source.id, teamId }, "Source created");
    return {
      id: source.id,
      teamId: source.teamId,
      name: source.name,
      type: source.type as LogSource["type"],
      config: source.config as Record<string, unknown>,
      retentionDays: source.retentionDays,
      createdAt: source.createdAt.toISOString(),
      apiKey: source.apiKey,
    };
  }

  async findSourceById(sourceId: string) {
    return prisma.logSource.findUnique({ where: { id: sourceId } });
  }

  private async validateToken(token: string) {
    const session = await prisma.session.findUnique({ where: { token } });
    if (!session || session.expiresAt < new Date()) {
      throw new Error("Unauthorized");
    }
    return session;
  }

  private async createSession(user: { id: string; email: string; name: string; role: string; createdAt: Date }): Promise<AuthResult> {
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
}
