import type { AuthResult, LogSource, Team, User } from "../../types/domain.js";
import { store } from "../../repositories/in-memory-store.js";
import { generateId, hashValue } from "../../utils/id.js";
import { nowIso } from "../../utils/time.js";

function sanitizeUser(user: User): Omit<User, "passwordHash"> {
  const { passwordHash, ...safeUser } = user;
  return safeUser;
}

export class TeamService {
  register(email: string, password: string, name: string): AuthResult {
    const existing = store.users.find((user) => user.email === email);
    if (existing) {
      throw new Error("User already exists");
    }

    const user: User = {
      id: generateId(),
      email,
      passwordHash: hashValue(password),
      name,
      role: "USER",
      createdAt: nowIso(),
    };
    store.users.push(user);
    return this.createSession(user);
  }

  login(email: string, password: string): AuthResult {
    const user = store.users.find(
      (item) => item.email === email && item.passwordHash === hashValue(password),
    );
    if (!user) {
      throw new Error("Invalid credentials");
    }
    return this.createSession(user);
  }

  listTeamsForToken(token: string): Team[] {
    const session = store.sessions.find((item) => item.token === token);
    if (!session) {
      throw new Error("Unauthorized");
    }
    const memberships = store.teamMembers.filter((member) => member.userId === session.userId);
    return store.teams.filter((team) => memberships.some((member) => member.teamId === team.id));
  }

  createTeam(token: string, name: string, slug: string): Team {
    const session = store.sessions.find((item) => item.token === token);
    if (!session) {
      throw new Error("Unauthorized");
    }
    const team: Team = {
      id: generateId(),
      name,
      slug,
      plan: "FREE",
      createdAt: nowIso(),
    };
    store.teams.push(team);
    store.teamMembers.push({
      id: generateId(),
      teamId: team.id,
      userId: session.userId,
      role: "OWNER",
      joinedAt: nowIso(),
    });
    return team;
  }

  listSources(teamId: string): LogSource[] {
    return store.sources.filter((source) => source.teamId === teamId);
  }

  createSource(teamId: string, name: string, type: LogSource["type"]): LogSource {
    const source: LogSource = {
      id: generateId(),
      teamId,
      name,
      type,
      config: {},
      retentionDays: 7,
      createdAt: nowIso(),
      apiKey: `lf_${hashValue(`${teamId}:${name}:${Date.now()}`).slice(0, 24)}`,
    };
    store.sources.push(source);
    return source;
  }

  private createSession(user: User): AuthResult {
    const token = `sess_${hashValue(`${user.id}:${Date.now()}`).slice(0, 24)}`;
    store.sessions.push({
      id: generateId(),
      userId: user.id,
      token,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    });
    return {
      token,
      user: sanitizeUser(user),
    };
  }
}

