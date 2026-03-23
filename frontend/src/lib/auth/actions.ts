"use server";

import { redirect } from "next/navigation";
import { setSession, clearSession } from "./session";
import type { SessionUser } from "@/types";

function getApiBaseUrl() {
  return (
    process.env.INTERNAL_API_BASE_URL ??
    process.env.NEXT_PUBLIC_API_BASE_URL ??
    "http://localhost:4000/api/v1"
  );
}

export async function loginAction(_prev: unknown, formData: FormData) {
  const email = formData.get("email") as string;
  const password = formData.get("password") as string;

  if (!email || !password) {
    return { error: "Email and password are required" };
  }

  const res = await fetch(`${getApiBaseUrl()}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
    cache: "no-store",
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    return { error: (body as { error?: string }).error ?? "Login failed" };
  }

  const data = (await res.json()) as { token: string; user: SessionUser };
  await setSession(data.token, data.user);
  redirect("/");
}

export async function registerAction(_prev: unknown, formData: FormData) {
  const email = formData.get("email") as string;
  const password = formData.get("password") as string;
  const name = formData.get("name") as string;

  if (!email || !password || !name) {
    return { error: "All fields are required" };
  }

  const res = await fetch(`${getApiBaseUrl()}/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, name }),
    cache: "no-store",
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    return { error: (body as { error?: string }).error ?? "Registration failed" };
  }

  const data = (await res.json()) as
    | { token: string; user: SessionUser }
    | { status: "pending_approval"; message: string };

  if (!("token" in data)) {
    return { success: data.message, pendingApproval: true };
  }

  await setSession(data.token, data.user);
  redirect("/");
}

export async function logoutAction() {
  await clearSession();
  redirect("/login");
}
