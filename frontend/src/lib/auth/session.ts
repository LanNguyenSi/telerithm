import { cookies } from "next/headers";
import type { SessionUser } from "@/types";

const TOKEN_COOKIE = "telerithm_token";
const USER_COOKIE = "telerithm_user";

export async function getSession(): Promise<{ token: string; user: SessionUser } | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(TOKEN_COOKIE)?.value;
  const userRaw = cookieStore.get(USER_COOKIE)?.value;
  if (!token || !userRaw) return null;
  try {
    return { token, user: JSON.parse(userRaw) as SessionUser };
  } catch {
    return null;
  }
}

export async function setSession(token: string, user: SessionUser): Promise<void> {
  const cookieStore = await cookies();
  const opts = {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: 7 * 24 * 60 * 60, // 7 days
  };
  cookieStore.set(TOKEN_COOKIE, token, opts);
  cookieStore.set(USER_COOKIE, JSON.stringify(user), { ...opts, httpOnly: false });
}

export async function clearSession(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(TOKEN_COOKIE);
  cookieStore.delete(USER_COOKIE);
}
