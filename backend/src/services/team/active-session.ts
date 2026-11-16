import { prisma } from "../../repositories/prisma.js";

// The one place a bearer token turns into a session. A token is live only
// while its row exists, it has not expired and its user is ACTIVE. The status
// check reads the user on every request, so disabling an account locks out
// its tokens at once, even for a session row that was not deleted (login
// refuses a user who is not ACTIVE, so a session of such a user is stale).
export async function findActiveSession(token: string) {
  const session = await prisma.session.findUnique({
    where: { token },
    include: { user: { select: { status: true } } },
  });
  return liveSessionOrNull(session);
}

// The same check for a caller that holds the session id instead of the token:
// a stream opened with a one-time ticket never sees the token again, but it
// stays bound to the session row it was issued for.
export async function findActiveSessionById(sessionId: string) {
  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    include: { user: { select: { status: true } } },
  });
  return liveSessionOrNull(session);
}

function liveSessionOrNull<T extends { expiresAt: Date; user: { status: string } }>(
  session: T | null,
): T | null {
  if (!session || session.expiresAt < new Date()) {
    return null;
  }
  if (session.user.status !== "ACTIVE") {
    return null;
  }
  return session;
}

// Re-check for a long-lived connection (the log stream): the token still
// resolves to the same user and that user is still a member of the team. The
// answer is false only for a definite "no"; a database error is thrown to the
// caller, which must not treat it as a revocation.
export async function isSessionAuthorizedForTeam(
  token: string,
  userId: string,
  teamId: string,
): Promise<boolean> {
  return isLiveSessionMemberOfTeam(await findActiveSession(token), userId, teamId);
}

// The same re-check for a stream that was opened with a ticket: the session it
// was issued for (by id) must still be live and belong to the same user.
export async function isSessionIdAuthorizedForTeam(
  sessionId: string,
  userId: string,
  teamId: string,
): Promise<boolean> {
  return isLiveSessionMemberOfTeam(await findActiveSessionById(sessionId), userId, teamId);
}

async function isLiveSessionMemberOfTeam(
  session: { userId: string } | null,
  userId: string,
  teamId: string,
): Promise<boolean> {
  if (!session || session.userId !== userId) {
    return false;
  }
  const membership = await prisma.teamMember.findUnique({
    where: { teamId_userId: { teamId, userId } },
  });
  return membership !== null;
}
