"use client";

import { createContext, useContext } from "react";
import type { Team } from "@/types";

interface LogAuth {
  team: Team;
  token: string;
}

const LogAuthCtx = createContext<LogAuth | null>(null);

export const LogAuthProvider = LogAuthCtx.Provider;

export function useLogAuth(): LogAuth {
  const ctx = useContext(LogAuthCtx);
  if (!ctx) throw new Error("useLogAuth must be used within LogAuthProvider");
  return ctx;
}
