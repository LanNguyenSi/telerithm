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
  const session = await findActiveSession(token);
  if (!session || session.userId !== userId) {
    return false;
  }
  const membership = await prisma.teamMember.findUnique({
    where: { teamId_userId: { teamId, userId } },
  });
  return membership !== null;
}
