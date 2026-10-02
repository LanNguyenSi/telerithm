"use client";

import { createContext, useContext } from "react";
import type { TeamWithRole } from "@/types";

interface LogAuth {
  team: TeamWithRole;
  token: string;
}

const LogAuthCtx = createContext<LogAuth | null>(null);

/**
 * Mirrors the backend rule for shared log-view state: only a team OWNER or
 * ADMIN may create shared views or mark a view as default.
 */
export function canManageSharedViews(role: TeamWithRole["role"]): boolean {
  return role === "OWNER" || role === "ADMIN";
}

export const SHARED_VIEWS_REASON = "Nur Team-Owner und Admins können Ansichten teilen oder als Standard setzen.";

export const LogAuthProvider = LogAuthCtx.Provider;

export function useLogAuth(): LogAuth {
  const ctx = useContext(LogAuthCtx);
  if (!ctx) throw new Error("useLogAuth must be used within LogAuthProvider");
  return ctx;
}
