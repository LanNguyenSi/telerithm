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
